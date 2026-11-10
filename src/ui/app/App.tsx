import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { CommandName } from "../../core/commands/index.ts";
import type { SearchMatch, Source } from "../../core/types.ts";
import { ClaudeDock } from "../components/claude/ClaudeDock.tsx";
import { ClaudeHolder } from "../components/claude/ClaudeTab.tsx";
import { JobDrawer } from "../components/jobs/JobDrawer.tsx";
import { useRunningJobs } from "../components/shell/Activity.tsx";
import { CommandForm, lossOf } from "../components/shell/CommandForm.tsx";
import { DesktopBridge } from "../components/shell/DesktopBridge.tsx";
import { OpenByKey } from "../components/shell/OpenByKey.tsx";
import { Palette } from "../components/shell/Palette.tsx";
import { firstSentence, hasInput } from "../components/shell/paletteEntries.tsx";
import { Rail } from "../components/shell/Rail.tsx";
import { ServerLost } from "../components/shell/ServerLost.tsx";
import { TopBar, TopBarContext, useTopBarSlots } from "../components/shell/TopBar.tsx";
import { UpdateNotice } from "../components/shell/UpdateNotice.tsx";
import { docLink } from "../components/sources/PassageView.tsx";
import { SourceTab } from "../components/sources/SourceTab.tsx";
import { Toaster } from "../components/ui/Toast.tsx";
import { AppContext, type AppState, type ClaudeRun, type Focus, SETUP_FROM_APP, type SourceFrom } from "../lib/app.ts";
import type { CommandInfo } from "../lib/data/client.ts";
import { execute } from "../lib/data/query.ts";
import { jumpTo, rememberHit } from "../lib/search.ts";
import { errorToast, jobToast, toast } from "../lib/toast.ts";
import { border, color, radius, shadow, space } from "../styles/tokens.stylex.ts";
import { commandToast, paletteActions } from "./paletteActions.ts";
import { parseRoute, TITLES, useRoute } from "./routes.ts";
import { ScreenGuard } from "./ScreenGuard.tsx";
import { Screens } from "./Screens.tsx";
import { useClaudeLock } from "./useClaudeLock.ts";
import { useDock } from "./useDock.ts";
import { useOpenFolder } from "./useOpenFolder.ts";
import { useProject } from "./useProject.ts";
import { useShellEvents } from "./useShellEvents.ts";

export { parseRoute };

// ponytail: the dock and the rail redraw for what they read (the context, their props), not each time the shell does
const Dock = memo(ClaudeDock);
const ShellRail = memo(Rail);

const sameFocus = (a: Focus | null, b: Focus | null) =>
  a === b || (!!a && !!b && a.testId === b.testId && a.key === b.key && a.summary === b.summary && a.step === b.step);

const styles = stylex.create({
  app: {
    position: "relative",
    display: "flex",
    width: "100vw",
    height: "100vh",
    overflow: "hidden",
    backgroundColor: color.canvas,
  },
  frame: {
    boxSizing: "border-box",
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    marginBlock: space.s3,
    marginInlineEnd: space.s3,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.surface,
    boxShadow: shadow.s1,
    overflow: "hidden",
  },
  round: { borderRadius: radius.r4 },
  screen: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" },
  holder: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
});

// ponytail: the shell — the rail, the top bar and the screen in their frame, the palette, the layers above (a
// command's form, a source, a job, the toasts); what the screens share is in AppContext. Claude is a tab of every screen's
// sections: the shell keeps the one dock (its element is moved into the Claude tab of the screen shown)
export function App() {
  const client = useQueryClient();
  const [route, navigate] = useRoute();
  const p = useProject(navigate);
  const [focus, keepFocus] = useState<Focus | null>(null);
  // ponytail: the editor says where it is at each change of its test; the window hears it only when that place moves —
  // a keystroke in a step is not a new focus for every screen
  const setFocus = useCallback((f: Focus | null) => keepFocus((cur) => (sameFocus(cur, f) ? cur : f)), []);
  const [lastRun, setLastRun] = useState<ClaudeRun | null>(null);
  const [testsNonce, setTestsNonce] = useState(0);
  const [source, setSource] = useState<{ source: Source; from?: SourceFrom } | null>(null);
  const [palette, setPalette] = useState(false);
  const [form, setForm] = useState<CommandInfo | null>(null);
  const [byKey, setByKey] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  const openJob = useCallback((id: string) => setJob(id), []);
  const dock = useDock();
  const [holder] = useState(() => {
    const el = document.createElement("div");
    el.className = stylex.props(styles.holder).className ?? "";
    return el;
  });
  const bar = useTopBarSlots();
  const running = useRunningJobs({ quiet: true });
  const { claudeRunning, setClaudeRunning } = useClaudeLock(running);

  // ponytail: a source or a job is read beside the work of the screen it was opened from; another screen (a link of the
  // job's « What to do ») does not inherit it
  // biome-ignore lint/correctness/useExhaustiveDependencies: closed when the screen changes
  useEffect(() => {
    setSource(null);
    setJob(null);
  }, [route.screen]);

  const testsChanged = useCallback(() => setTestsNonce((n) => n + 1), []);
  const { refreshInfo, closeProject: close } = p;
  const closeProject = useCallback(() => {
    close();
    testsChanged();
  }, [close, testsChanged]);
  const openPalette = useCallback(() => setPalette(true), []);
  useShellEvents(navigate);

  const toggleDock = dock.toggle;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPalette((o) => !o);
      } else if (k === "j") {
        e.preventDefault();
        toggleDock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDock]);

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

  const app: AppState = useMemo(
    () => ({
      info: p.info,
      xray: p.xray,
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
      openSource: (s: Source, from?: SourceFrom) => setSource({ source: s, from }),
      askClaude: dock.askClaude,
      runInDock: dock.runInDock,
      askAbout: dock.askAbout,
      openPalette,
      openJob,
    }),
    [
      p.info,
      p.xray,
      route,
      focus,
      claudeRunning,
      lastRun,
      testsNonce,
      navigate,
      setFocus,
      setClaudeRunning,
      testsChanged,
      refreshInfo,
      closeProject,
      dock.askClaude,
      dock.runInDock,
      dock.askAbout,
      openPalette,
      openJob,
    ],
  );

  const openFolder = useOpenFolder(app);
  const { askDocs, askClaude } = dock;
  // ponytail: a command from the palette takes the way the app has for it — a project opens as the rail opens it,
  // Claude's question and run go to the dock; a command with input or a loss opens its form; the rest runs
  const runCommand = useCallback(
    (c: CommandInfo) => {
      if (c.name === "project.open") return void openFolder();
      if (c.name === "project.openKey") return setByKey(true);
      if (c.name === "project.init") return navigate("setup", SETUP_FROM_APP);
      if (c.name === "chat.ask") return askDocs();
      if (c.name === "claude.run") return askClaude("test");
      if (hasInput(c) || lossOf(c.name, {})) {
        setForm(c);
        return;
      }
      const what = firstSentence(c.summary) || c.name;
      execute(client, c.name as CommandName, {} as never, { invalidates: c.mutates ? "project" : "none" })
        .then((r) => {
          const jobId = (r as { jobId?: string } | null)?.jobId;
          if (jobId) jobToast(`${what} — started`, jobId, openJob);
          else toast(commandToast(c, r));
          if (c.mutates) testsChanged();
        })
        .catch((e) => errorToast(e, `${what} — failed`));
    },
    [client, testsChanged, navigate, openFolder, askDocs, askClaude, openJob],
  );

  const hasProject = !!p.info;
  const actions = useMemo(() => paletteActions(navigate, toggleDock, hasProject), [navigate, toggleDock, hasProject]);

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

  const awaiting = p.info?.counts?.awaiting;
  const counts = useMemo(() => ({ review: awaiting }), [awaiting]);

  return (
    <AppContext.Provider value={app}>
      {route.screen === "setup" ? (
        p.booted && <Screens screen="setup" />
      ) : (
        <div {...stylex.props(styles.app)}>
          <ShellRail counts={counts} kit={p.mock} />
          <div key={p.dir ?? ""} {...stylex.props(styles.frame, styles.round)}>
            <TopBarContext.Provider value={bar.value}>
              <TopBar title={TITLES[route.screen]} onPalette={openPalette} slots={bar} />
              <ServerLost />
              <div {...stylex.props(styles.screen)}>
                {p.booted && (
                  <ClaudeHolder.Provider value={holder}>
                    <ScreenGuard route={`${route.screen}/${route.arg ?? ""}`}>
                      <Screens screen={route.screen} />
                    </ScreenGuard>
                  </ClaudeHolder.Provider>
                )}
              </div>
            </TopBarContext.Provider>
          </div>
          {createPortal(<Dock request={dock.request} />, holder)}
        </div>
      )}
      {palette && (
        <Palette
          commands={p.commands}
          actions={actions}
          onCommand={runCommand}
          onHit={p.info ? openHit : undefined}
          onAsk={p.info ? (q) => askDocs(q, true) : undefined}
          onClose={() => setPalette(false)}
        />
      )}
      {form && (
        <CommandForm
          command={form}
          onClose={() => setForm(null)}
          onBack={() => {
            setForm(null);
            setPalette(true);
          }}
        />
      )}
      {byKey && <OpenByKey onClose={() => setByKey(false)} />}
      {job && <JobDrawer key={job} id={job} onClose={() => setJob(null)} onGo={navigate} />}
      <SourceTab
        opened={source}
        onClose={() => setSource(null)}
        onOpenDoc={(docId, anchor, quote, cited) => {
          setSource(null);
          navigate("documents", docLink(docId, anchor, quote, cited));
        }}
      />
      <Toaster />
      <DesktopBridge booted={p.booted} />
      <UpdateNotice booted={p.booted} />
    </AppContext.Provider>
  );
}
