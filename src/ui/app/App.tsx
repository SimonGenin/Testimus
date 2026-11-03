import { useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ColumnLayout, CredsStatus, Job, SearchMatch, Source, XrayJson } from "../../core/types.ts";
import { ApiError, type CommandInfo, call, commands, events, project, setProject } from "../api.ts";
import { ClaudeDock, type DockJob, type DockRequest } from "../components/claude/ClaudeDock.tsx";
import { CONTEXTS_EVENT } from "../components/claude/ContextsDialog.tsx";
import { DragEdge, Toasts } from "../components/legacy/index.ts";
import { CommandForm, hasInput } from "../components/shell/CommandForm.tsx";
import { DesktopBridge } from "../components/shell/DesktopBridge.tsx";
import { Palette, type PaletteAction } from "../components/shell/Palette.tsx";
import { NAV, Rail } from "../components/shell/Rail.tsx";
import { PassageDialog } from "../components/sources/PassageDialog.tsx";
import { docLink } from "../components/sources/PassageView.tsx";
import { actionsChanged, triageWhenClaude } from "../lib/actions.ts";
import { AppContext, type AppState, type ClaudeRun, type Focus, type ProjectInfo, type Screen } from "../lib/app.ts";
import { touches, useChanged } from "../lib/changed.ts";
import { DEFAULT_LAYOUT } from "../lib/fields.ts";
import { mirrorPrefs, restorePrefs } from "../lib/prefsMirror.ts";
import { jumpTo, rememberHit } from "../lib/search.ts";
import { useSideWidth } from "../lib/sideWidth.ts";
import { readSession, readString, setThemeEverywhere, writePref, writeSession } from "../lib/theme.ts";
import { errorToast, toast } from "../lib/toast.ts";
import { DoctorScreen } from "../screens/doctor/DoctorScreen.tsx";
import { DocumentsScreen } from "../screens/documents/DocumentsScreen.tsx";
import { GenerateScreen } from "../screens/generate/GenerateScreen.tsx";
import { JobsScreen } from "../screens/jobs/JobsScreen.tsx";
import { KitScreen } from "../screens/kit/KitScreen.tsx";
import { ReviewScreen } from "../screens/review/ReviewScreen.tsx";
import { SettingsScreen } from "../screens/settings/SettingsScreen.tsx";
import { FirstRunScreen } from "../screens/setup/FirstRunScreen.tsx";
import { TestsScreen } from "../screens/tests/TestsScreen.tsx";

const SCREENS: Screen[] = ["documents", "generate", "tests", "review", "jobs", "settings", "doctor", "setup", "kit"];

export function parseRoute(hash: string): { screen: Screen; arg?: string } {
  const [screen, ...rest] = hash.replace(/^#\/?/, "").split("/");
  const s = SCREENS.includes(screen as Screen) ? (screen as Screen) : "tests";
  const arg = rest.length ? decodeURIComponent(rest.join("/")) : undefined;
  return { screen: s, arg };
}

// ponytail: a failed job of the documents, the index or the tests is shown to Claude once, cheaply (project model, low
// effort), when Claude is there — it may leave a Claude action on the job; a Claude run or a Jira call is never triaged
const TRIAGED = /^(docs\.|rag-|rag\.|describe-figures|generate|check)/;
const triaged = new Set<string>();

function triageFailed(job: Job): void {
  if (!TRIAGED.test(job.kind) || triaged.has(job.id)) return;
  triaged.add(job.id);
  triageWhenClaude({ jobId: job.id });
}

export function App() {
  const client = useQueryClient();
  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [xray, setXray] = useState<ColumnLayout>(DEFAULT_LAYOUT);
  const [cmds, setCmds] = useState<CommandInfo[]>([]);
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  const [focus, setFocus] = useState<Focus | null>(null);
  const [claudeRunning, setClaudeRunning] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<ClaudeRun | null>(null);
  const [testsNonce, setTestsNonce] = useState(0);
  const [source, setSource] = useState<Source | null>(null);
  const [palette, setPalette] = useState(false);
  const [form, setForm] = useState<CommandInfo | null>(null);
  const [folded, setFolded] = useState(true);
  const [dockW, dockEdge] = useSideWidth("testimus.dockWidth", 300, 720, "after");
  const [dockReq, setDockReq] = useState<DockRequest | null>(null);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const [booted, setBooted] = useState(false);
  const userFold = useRef<boolean | null>(null);

  const refreshInfo = useCallback(() => {
    call<ProjectInfo>("project.info", {})
      .then((r) => {
        setInfo(r);
        setXray({
          ...(r?.xray?.fetchedAt ? { fetchedAt: r.xray.fetchedAt } : {}),
          fields: r?.xray?.fields?.length ? r.xray.fields : DEFAULT_LAYOUT.fields,
          columns: r?.columns?.length ? r.columns : DEFAULT_LAYOUT.columns,
        });
      })
      .catch((e) => errorToast(e, "Could not read the project"));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: once, at start (navigate is stable)
  useEffect(() => {
    let stopMirror = () => {};
    commands()
      .then(async (r) => {
        if (await restorePrefs(client)) {
          window.location.reload();
          return;
        }
        stopMirror = mirrorPrefs(client);
        const stored = readString("testimus.project");
        setCmds(r.commands ?? []);
        setProject(stored || r.project);
        // ponytail: a project this window remembers but the server no longer knows (deleted, moved, forgotten) is
        // dropped at start, not opened — every call made for it would be refused
        const refused = (e: unknown) => e instanceof ApiError && e.status === 403;
        if (stored && (await call("project.info", {}).then(() => false, refused))) {
          writePref("testimus.project", "");
          setProject(r.project);
        }
        const dir = project();
        if (dir) refreshInfo();
        setBooted(true);
        const shown = readSession("testimus.setupShown") === "1";
        if (shown || parseRoute(window.location.hash).screen === "setup") return;
        const st = await call<{ status: CredsStatus }>("system.setup", {}).catch(() => null);
        const creds = !st || (st.status.jira.complete && st.status.xray.complete);
        if (!dir || !creds) {
          writeSession("testimus.setupShown", "1");
          navigate("setup", creds ? "project" : undefined);
        }
      })
      .catch((e) => errorToast(e, "Testimus is not answering"));
    return () => stopMirror();
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
      if (e.job.status === "failed") triageFailed(e.job);
      if (e.job.kind === "check" && e.job.status === "done") {
        const tests = ((e.job.result as { tests?: { errors: number; warnings: number }[] })?.tests ?? []).filter(
          Boolean,
        );
        const n = tests.filter((t) => t.errors + t.warnings > 0).length;
        toast({
          kind: "ok",
          title: `Check finished — ${tests.length} test${tests.length === 1 ? "" : "s"}, ${n} with findings`,
          action:
            parseRoute(window.location.hash).screen === "review"
              ? undefined
              : {
                  label: "Open Review",
                  run: () => {
                    window.location.hash = "#/review";
                  },
                },
        });
      }
    });
  }, []);

  // ponytail: a project's step columns are read again from Xray each time it is opened (Xray Editor does) — quietly:
  // offline, or without access yet, the copy in xray.json stays
  const fieldsFor = useRef("");
  const jiraKey = info?.project.jiraOffline ? "" : info?.project.jiraProject;
  useEffect(() => {
    const dir = info?.dir;
    if (!dir || !jiraKey || fieldsFor.current === dir) return;
    fieldsFor.current = dir;
    call<XrayJson>("xray.refreshFields", {})
      .then((x) => {
        if (fieldsFor.current === dir && x?.fields?.length) refreshInfo();
      })
      .catch(() => {});
  }, [info?.dir, jiraKey, refreshInfo]);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // ponytail: a file dropped beside a drop target would make the browser open it in place of the app
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    document.addEventListener("dragover", guard);
    document.addEventListener("drop", guard);
    return () => {
      document.removeEventListener("dragover", guard);
      document.removeEventListener("drop", guard);
    };
  }, []);

  const toggleDock = useCallback(() => {
    setFolded((f) => {
      userFold.current = !f;
      return !f;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
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
    else if (was === "review" && route.screen !== "review") setFolded(userFold.current ?? true);
  }, [route.screen]);

  const testsChanged = useCallback(() => setTestsNonce((n) => n + 1), []);

  const closeProject = useCallback(() => {
    setProject(null);
    writePref("testimus.project", "");
    setInfo(null);
    setXray(DEFAULT_LAYOUT);
    testsChanged();
  }, [testsChanged]);

  useChanged([""], (paths) => {
    refreshInfo();
    if (touches(paths, ["tests/"]).length) testsChanged();
    if (touches(paths, [".testimus/actions/"]).length) actionsChanged();
    if (
      touches(paths, ["contexts/", "project.json"]).length ||
      paths.some((p) => p.endsWith("/local.json") || p.endsWith("/doc.json"))
    )
      window.dispatchEvent(new Event(CONTEXTS_EVENT));
  });
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
      closeProject,
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
      closeProject,
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

  const openHit = useCallback(
    (h: SearchMatch) => {
      rememberHit(h);
      if (h.kind === "test") {
        jumpTo(h.id, h.awaiting ? undefined : h.step);
        navigate("tests", h.id);
      } else if (h.kind === "document") navigate("documents", h.id);
      else if (h.docId && h.anchor) navigate("documents", docLink(h.docId, h.anchor));
    },
    [navigate],
  );

  const counts: Partial<Record<Screen, number>> = {
    review: info?.counts?.awaiting,
    jobs: running.size,
  };

  return (
    <AppContext.Provider value={app}>
      {route.screen === "setup" ? (
        <FirstRunScreen />
      ) : (
        <div className="shell" style={dockW ? ({ "--dock-size": `${dockW}px` } as CSSProperties) : undefined}>
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
            ) : route.screen === "kit" ? (
              <KitScreen />
            ) : (
              <SettingsScreen />
            )}
          </div>
          {!folded && <DragEdge className="side-edge dock-edge" label="Resize the Claude panel" {...dockEdge} />}
          <ClaudeDock folded={folded} request={dockReq} onFold={toggleDock} />
        </div>
      )}
      {palette && (
        <Palette
          commands={cmds}
          actions={actions}
          onCommand={runCommand}
          onHit={info ? openHit : undefined}
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
          onOpenDoc={(docId, anchor, quote) => {
            setSource(null);
            navigate("documents", docLink(docId, anchor, quote));
          }}
        />
      )}
      <Toasts />
      <DesktopBridge booted={booted} />
    </AppContext.Provider>
  );
}
