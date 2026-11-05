import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { CommandName } from "../../core/commands/index.ts";
import type { SearchMatch, Source } from "../../core/types.ts";
import { ClaudeDock } from "../components/claude/ClaudeDock.tsx";
import { useRunningJobs } from "../components/shell/Activity.tsx";
import { CommandForm, lossOf } from "../components/shell/CommandForm.tsx";
import { DesktopBridge } from "../components/shell/DesktopBridge.tsx";
import { OpenByKey } from "../components/shell/OpenByKey.tsx";
import { Palette } from "../components/shell/Palette.tsx";
import { useOpenFolder } from "../components/shell/ProjectButton.tsx";
import { firstSentence, hasInput } from "../components/shell/paletteEntries.tsx";
import { Rail } from "../components/shell/Rail.tsx";
import { ServerLost } from "../components/shell/ServerLost.tsx";
import { TopBar, TopBarContext, useTopBarSlots } from "../components/shell/TopBar.tsx";
import { UpdateNotice } from "../components/shell/UpdateNotice.tsx";
import { PassageDialog } from "../components/sources/PassageDialog.tsx";
import { docLink } from "../components/sources/PassageView.tsx";
import { ResizeHandle } from "../components/ui/ResizeHandle.tsx";
import { Toaster } from "../components/ui/Toast.tsx";
import { AppContext, type AppState, type ClaudeRun, type Focus, type SourceFrom } from "../lib/app.ts";
import type { CommandInfo } from "../lib/data/client.ts";
import { execute } from "../lib/data/query.ts";
import { usePaneWidth } from "../lib/panes.ts";
import { jumpTo, rememberHit } from "../lib/search.ts";
import { errorToast, jobToast, toast } from "../lib/toast.ts";
import { border, breakpoint, color, radius, shadow, size, space, z } from "../styles/tokens.stylex.ts";
import { commandToast, paletteActions } from "./paletteActions.ts";
import { parseRoute, TITLES, useRoute } from "./routes.ts";
import { ScreenGuard } from "./ScreenGuard.tsx";
import { Screens } from "./Screens.tsx";
import { useClaudeLock } from "./useClaudeLock.ts";
import { useDock } from "./useDock.ts";
import { useProject } from "./useProject.ts";
import { useShellEvents } from "./useShellEvents.ts";

export { parseRoute };

const DOCK = { min: 300, max: 720, initial: 440 };

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
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.surface,
    boxShadow: shadow.s1,
    overflow: "hidden",
  },
  round: { borderRadius: radius.r4 },
  frameOpen: { marginInlineEnd: { default: 0, [breakpoint.dock]: space.s3 } },
  screen: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" },
  dock: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    width: size.dockFolded,
    zIndex: `calc(${z.sticky} + 1)`,
  },
  dockOpen: {
    width: "var(--dock-size)",
    margin: space.s3,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.r4,
    backgroundColor: color.surface,
    overflow: "hidden",
    position: { default: "relative", [breakpoint.dock]: "absolute" },
    insetBlock: { default: null, [breakpoint.dock]: 0 },
    insetInlineEnd: { default: null, [breakpoint.dock]: 0 },
    maxWidth: `calc(100vw - ${size.rail} - ${space.s7})`,
    boxShadow: { default: shadow.s1, [breakpoint.dock]: shadow.s3 },
  },
  edge: { display: { default: "flex", [breakpoint.dock]: "none" } },
});

// ponytail: the shell — the rail, the top bar and the screen in their frame, the Claude dock, the palette, the
// layers above (a command's form, a source, the toasts); what the screens share is in AppContext
export function App() {
  const client = useQueryClient();
  const [route, navigate] = useRoute();
  const p = useProject(navigate);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [lastRun, setLastRun] = useState<ClaudeRun | null>(null);
  const [testsNonce, setTestsNonce] = useState(0);
  const [source, setSource] = useState<{ source: Source; from?: SourceFrom } | null>(null);
  const [palette, setPalette] = useState(false);
  const [form, setForm] = useState<CommandInfo | null>(null);
  const [byKey, setByKey] = useState(false);
  const dockPane = usePaneWidth("dockWidth", DOCK);
  const dock = useDock(route.screen);
  const bar = useTopBarSlots();
  const running = useRunningJobs();
  const { claudeRunning, setClaudeRunning } = useClaudeLock(running);

  const testsChanged = useCallback(() => setTestsNonce((n) => n + 1), []);
  const { refreshInfo, closeProject: close } = p;
  const closeProject = useCallback(() => {
    close();
    testsChanged();
  }, [close, testsChanged]);
  const openPalette = useCallback(() => setPalette(true), []);
  useShellEvents(testsChanged, navigate);

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
      setClaudeRunning,
      testsChanged,
      refreshInfo,
      closeProject,
      dock.askClaude,
      dock.runInDock,
      dock.askAbout,
      openPalette,
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
      if (c.name === "project.init") return navigate("setup", "project");
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
          if (jobId) jobToast(`${what} — started`, jobId, navigate);
          else toast(commandToast(c, r));
          if (c.mutates) testsChanged();
        })
        .catch((e) => errorToast(e, `${what} — failed`));
    },
    [client, testsChanged, navigate, openFolder, askDocs, askClaude],
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

  const counts = { review: p.info?.counts?.awaiting, jobs: running.length };

  return (
    <AppContext.Provider value={app}>
      {route.screen === "setup" ? (
        p.booted && <Screens screen="setup" />
      ) : (
        <div {...stylex.props(styles.app)}>
          <Rail counts={counts} kit={p.mock} />
          <div key={p.dir ?? ""} {...stylex.props(styles.frame, styles.round, !dock.folded && styles.frameOpen)}>
            <TopBarContext.Provider value={bar.value}>
              <TopBar title={TITLES[route.screen]} onPalette={openPalette} slots={bar} />
              <ServerLost />
              <div {...stylex.props(styles.screen)}>
                {p.booted && (
                  <ScreenGuard route={`${route.screen}/${route.arg ?? ""}`}>
                    <Screens screen={route.screen} />
                  </ScreenGuard>
                )}
              </div>
            </TopBarContext.Provider>
          </div>
          {!dock.folded && (
            <span {...stylex.props(styles.edge)}>
              <ResizeHandle label="Resize the Claude panel" side="left" quiet {...dockPane.handle} />
            </span>
          )}
          <div
            {...stylex.props(styles.dock, !dock.folded && styles.dockOpen)}
            style={dock.folded ? undefined : ({ "--dock-size": `${dockPane.width}px` } as CSSProperties)}
          >
            <ClaudeDock folded={dock.folded} request={dock.request} onFold={toggleDock} />
          </div>
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
      {source && (
        <PassageDialog
          source={source.source}
          from={source.from}
          onClose={() => setSource(null)}
          onOpenDoc={(docId, anchor, quote, cited) => {
            setSource(null);
            navigate("documents", docLink(docId, anchor, quote, cited));
          }}
        />
      )}
      <Toaster clearEnd={route.screen === "setup" || dock.folded ? undefined : `${dockPane.width}px`} />
      <DesktopBridge booted={p.booted} />
      <UpdateNotice booted={p.booted} />
    </AppContext.Provider>
  );
}
