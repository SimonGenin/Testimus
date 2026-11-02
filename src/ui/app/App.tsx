import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CredsStatus, Job, Source, XrayJson } from "../../core/types.ts";
import { type CommandInfo, call, commands, events, fileUrl, setProject } from "../api.ts";
import { ClaudeDock, type DockJob, type DockRequest } from "../components/claude/ClaudeDock.tsx";
import { CommandForm, hasInput } from "../components/shell/CommandForm.tsx";
import { DesktopBridge } from "../components/shell/DesktopBridge.tsx";
import { Palette, type PaletteAction } from "../components/shell/Palette.tsx";
import { NAV, Rail } from "../components/shell/Rail.tsx";
import { PassageDialog } from "../components/sources/PassageDialog.tsx";
import { Toasts } from "../components/ui/index.ts";
import { AppContext, type AppState, type ClaudeRun, type Focus, type ProjectInfo, type Screen } from "../lib/app.ts";
import { DEFAULT_XRAY } from "../lib/fields.ts";
import { readSession, readString, setThemeEverywhere, writeSession } from "../lib/theme.ts";
import { errorToast, toast } from "../lib/toast.ts";
import { DoctorScreen } from "../screens/doctor/DoctorScreen.tsx";
import { DocumentsScreen } from "../screens/documents/DocumentsScreen.tsx";
import { GenerateScreen } from "../screens/generate/GenerateScreen.tsx";
import { ImportScreen } from "../screens/import/ImportScreen.tsx";
import { JobsScreen } from "../screens/jobs/JobsScreen.tsx";
import { ReviewScreen } from "../screens/review/ReviewScreen.tsx";
import { SettingsScreen } from "../screens/settings/SettingsScreen.tsx";
import { FirstRunScreen } from "../screens/setup/FirstRunScreen.tsx";
import { TestsScreen } from "../screens/tests/TestsScreen.tsx";

const SCREENS: Screen[] = ["documents", "generate", "tests", "review", "jobs", "settings", "doctor", "import", "setup"];

export function parseRoute(hash: string): { screen: Screen; arg?: string } {
  const [screen, ...rest] = hash.replace(/^#\/?/, "").split("/");
  const s = SCREENS.includes(screen as Screen) ? (screen as Screen) : "tests";
  const arg = rest.length ? decodeURIComponent(rest.join("/")) : undefined;
  return { screen: s, arg };
}

const NARROW = 1280;

export function App() {
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [xray, setXray] = useState<XrayJson>(DEFAULT_XRAY);
  const [cmds, setCmds] = useState<CommandInfo[]>([]);
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const [focus, setFocus] = useState<Focus | null>(null);
  const [claudeRunning, setClaudeRunning] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<ClaudeRun | null>(null);
  const [testsNonce, setTestsNonce] = useState(0);
  const [source, setSource] = useState<Source | null>(null);
  const [palette, setPalette] = useState(false);
  const [form, setForm] = useState<CommandInfo | null>(null);
  const [folded, setFolded] = useState(() => window.innerWidth <= NARROW);
  const [dockReq, setDockReq] = useState<DockRequest | null>(null);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [booted, setBooted] = useState(false);
  const userFold = useRef<boolean | null>(null);

  const refreshInfo = useCallback(() => {
    call<ProjectInfo>("project.info", {})
      .then(async (r) => {
        setInfo(r);
        if (r?.xray?.fields?.length) setXray(r.xray);
        else {
          const res = await fetch(fileUrl("xray.json"));
          if (res.ok) setXray({ ...DEFAULT_XRAY, ...((await res.json()) as XrayJson) });
        }
      })
      .catch(async (e) => {
        try {
          const res = await fetch(fileUrl("xray.json"));
          if (res.ok) {
            setXray({ ...DEFAULT_XRAY, ...((await res.json()) as XrayJson) });
            return;
          }
        } catch {}
        errorToast(e, "Could not read the project");
      });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, at start (navigate is stable)
  useEffect(() => {
    const stored = readString("testimus.project");
    commands()
      .then(async (r) => {
        setCmds(r.commands ?? []);
        const dir = stored || r.project;
        setProject(dir);
        if (dir) refreshInfo();
        setBooted(true);
        const shown = readSession("testimus.setupShown");
        if (shown || parseRoute(window.location.hash).screen === "setup") return;
        const st = await call<{ status: CredsStatus }>("system.setup", {}).catch(() => null);
        const creds = !st || (st.status.jira.complete && st.status.xray.complete);
        if (!dir || !creds) {
          writeSession("testimus.setupShown", "1");
          navigate("setup", creds ? "project" : undefined);
        }
      })
      .catch((e) => errorToast(e, "Testimus is not answering"));
  }, [refreshInfo]);

  useEffect(() => {
    call<Job[]>("jobs.list", { running: true })
      .then((jobs) => setRunning(new Set((jobs ?? []).map((j) => j.id))))
      .catch(() => {});
    return events((e) => {
      if (e.type !== "status") return;
      setRunning((cur) => {
        const next = new Set(cur);
        if (e.job.status === "running") next.add(e.job.id);
        else next.delete(e.job.id);
        return next;
      });
      if (e.job.kind === "check" && e.job.status === "done") {
        const tests = ((e.job.result as { tests?: { errors: number; warnings: number }[] })?.tests ?? []).filter(
          Boolean,
        );
        const n = tests.filter((t) => t.errors + t.warnings > 0).length;
        toast({
          kind: "ok",
          title: `Check finished — ${tests.length} test${tests.length === 1 ? "" : "s"}, ${n} with findings`,
          action: {
            label: "Open Review",
            run: () => {
              window.location.hash = "#/review";
            },
          },
        });
      }
    });
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    const onResize = () => {
      if (userFold.current !== null) return;
      setFolded(window.innerWidth <= NARROW);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const toggleDock = useCallback(() => {
    setFolded((f) => {
      userFold.current = !f;
      return !f;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (k === "j") {
        e.preventDefault();
        toggleDock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDock]);

  const navigate = useCallback((screen: Screen, arg?: string) => {
    const hash = `#/${screen}${arg ? `/${encodeURIComponent(arg)}` : ""}`;
    if (window.location.hash !== hash) window.location.hash = hash;
    setRoute({ screen, arg });
  }, []);

  const askClaude = useCallback((scope: "test" | "step", prompt?: string) => {
    userFold.current = false;
    setFolded(false);
    setDockReq({ mode: "test", scope, prompt, nonce: Date.now() });
  }, []);

  const runInDock = useCallback((job: DockJob) => {
    setFolded(false);
    setDockReq({ mode: "test", job, nonce: Date.now() });
  }, []);

  // ponytail: Review needs its three columns, so the dock folds to its strip there and comes back after
  const lastScreen = useRef<Screen | null>(null);
  useEffect(() => {
    const was = lastScreen.current;
    lastScreen.current = route.screen;
    if (route.screen === "review" && was !== "review") setFolded(true);
    else if (was === "review" && route.screen !== "review") setFolded(userFold.current ?? window.innerWidth <= NARROW);
  }, [route.screen]);

  const testsChanged = useCallback(() => setTestsNonce((n) => n + 1), []);
  const openPalette = useCallback(() => setPalette(true), []);

  const app: AppState = useMemo(
    () => ({
      info,
      xray,
      route,
      focus,
      claudeRunning,
      lastRun,
      testsNonce,
      navigate,
      setFocus,
      setClaudeRunning,
      setLastRun,
      testsChanged,
      refreshInfo,
      openSource: setSource,
      askClaude,
      runInDock,
      openPalette,
    }),
    [
      info,
      xray,
      route,
      focus,
      claudeRunning,
      lastRun,
      testsNonce,
      navigate,
      testsChanged,
      refreshInfo,
      askClaude,
      runInDock,
      openPalette,
    ],
  );

  const runCommand = useCallback(
    (c: CommandInfo) => {
      if (hasInput(c)) {
        setForm(c);
        return;
      }
      call<unknown>(c.name, {})
        .then((r) => {
          const jobId = (r as { jobId?: string } | null)?.jobId;
          toast({
            kind: "ok",
            title: jobId ? `${c.name} started` : `${c.name} done`,
            detail: jobId ? "Follow it in Jobs." : undefined,
          });
          if (c.mutates) {
            refreshInfo();
            testsChanged();
          }
        })
        .catch((e) => errorToast(e, `${c.name} failed`));
    },
    [refreshInfo, testsChanged],
  );

  const actions: PaletteAction[] = useMemo(
    () => [
      ...NAV.map((n) => ({ id: `go-${n.id}`, label: `Go to ${n.label}`, icon: n.icon, run: () => navigate(n.id) })),
      { id: "go-settings", label: "Go to Settings", icon: "settings" as const, run: () => navigate("settings") },
      { id: "go-doctor", label: "Open the system check", icon: "info" as const, run: () => navigate("doctor") },
      { id: "go-import", label: "Import a CSV of tests", icon: "pull" as const, run: () => navigate("import") },
      { id: "dock", label: "Show or hide Claude", icon: "claude" as const, hint: "Ctrl J", run: toggleDock },
      {
        id: "theme-system",
        label: "Theme: follow the system",
        icon: "system" as const,
        run: () => setThemeEverywhere("system"),
      },
      { id: "theme-light", label: "Theme: light", icon: "sun" as const, run: () => setThemeEverywhere("light") },
      { id: "theme-dark", label: "Theme: dark", icon: "moon" as const, run: () => setThemeEverywhere("dark") },
    ],
    [navigate, toggleDock],
  );

  const review = info?.counts?.review;
  const counts: Partial<Record<Screen, number>> = {
    review: (review?.checked ?? 0) + (review?.["to-fix"] ?? 0),
    jobs: running.size,
  };

  return (
    <AppContext.Provider value={app}>
      {route.screen === "setup" ? (
        <FirstRunScreen />
      ) : (
        <div className="shell">
          <Rail counts={counts} />
          <div className="main">
            {route.screen === "tests" ? (
              <TestsScreen />
            ) : route.screen === "documents" ? (
              <DocumentsScreen />
            ) : route.screen === "generate" ? (
              <GenerateScreen />
            ) : route.screen === "review" ? (
              <ReviewScreen />
            ) : route.screen === "jobs" ? (
              <JobsScreen />
            ) : route.screen === "doctor" ? (
              <DoctorScreen />
            ) : route.screen === "import" ? (
              <ImportScreen />
            ) : (
              <SettingsScreen />
            )}
          </div>
          <ClaudeDock folded={folded} request={dockReq} onFold={toggleDock} />
        </div>
      )}
      {palette && (
        <Palette
          commands={cmds}
          actions={actions}
          onCommand={runCommand}
          onAsk={(q) => {
            userFold.current = false;
            setFolded(false);
            setDockReq({ mode: "docs", prompt: q, nonce: Date.now() });
          }}
          onClose={() => setPalette(false)}
        />
      )}
      {form && <CommandForm command={form} onClose={() => setForm(null)} onJob={() => navigate("jobs")} />}
      {source && (
        <PassageDialog
          source={source}
          onClose={() => setSource(null)}
          onOpenDoc={(docId, anchor) => {
            setSource(null);
            navigate("documents", `${docId}#${anchor}`);
          }}
        />
      )}
      <Toasts />
      <DesktopBridge booted={booted} />
    </AppContext.Provider>
  );
}
