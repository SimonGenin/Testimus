import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import type { CommandName } from "../../core/commands/index.ts";
import type { SearchMatch, Source } from "../../core/types.ts";
import { ClaudeDock } from "../components/claude/ClaudeDock.tsx";
import { useRunningJobs } from "../components/shell/Activity.tsx";
import { CommandForm } from "../components/shell/CommandForm.tsx";
import { DesktopBridge } from "../components/shell/DesktopBridge.tsx";
import { Palette } from "../components/shell/Palette.tsx";
import { hasInput } from "../components/shell/paletteEntries.tsx";
import { Rail } from "../components/shell/Rail.tsx";
import { ServerLost } from "../components/shell/ServerLost.tsx";
import { TopBar, TopBarContext, useTopBarSlots } from "../components/shell/TopBar.tsx";
import { PassageDialog } from "../components/sources/PassageDialog.tsx";
import { docLink } from "../components/sources/PassageView.tsx";
import { ResizeHandle } from "../components/ui/ResizeHandle.tsx";
import { Toaster } from "../components/ui/Toast.tsx";
import { AppContext, type AppState, type ClaudeRun, type Focus } from "../lib/app.ts";
import type { CommandInfo } from "../lib/data/client.ts";
import { execute } from "../lib/data/query.ts";
import { usePref } from "../lib/prefs.ts";
import { jumpTo, rememberHit } from "../lib/search.ts";
import { errorToast, toast } from "../lib/toast.ts";
import { border, breakpoint, color, radius, shadow, size, space } from "../styles/tokens.stylex.ts";
import { paletteActions } from "./paletteActions.ts";
import { parseRoute, TITLES, useRoute } from "./routes.ts";
import { Screens } from "./Screens.tsx";
import { useDock } from "./useDock.ts";
import { useProject } from "./useProject.ts";
import { useShellEvents } from "./useShellEvents.ts";

export { parseRoute };

const DOCK = { min: 300, max: 720, start: 420 };

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
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    marginBlock: space.s2,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderStartStartRadius: radius.r3,
    borderEndStartRadius: radius.r3,
    backgroundColor: color.surface,
    overflow: "hidden",
  },
  frameOpen: { borderRadius: radius.r3, marginInlineEnd: { default: 0, [breakpoint.dock]: space.s2 } },
  screen: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column", position: "relative" },
  dock: { flex: "none", display: "flex", width: size.dockFolded, zIndex: 1 },
  dockOpen: {
    width: "var(--dock-size)",
    marginBlock: space.s2,
    marginInline: space.s2,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
    overflow: "hidden",
    position: { default: "relative", [breakpoint.dock]: "absolute" },
    insetBlock: { default: null, [breakpoint.dock]: 0 },
    insetInlineEnd: { default: null, [breakpoint.dock]: 0 },
    maxWidth: `calc(100vw - ${size.rail} - ${space.s7})`,
    boxShadow: { default: null, [breakpoint.dock]: shadow.s3 },
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
  const [claudeRunning, setClaudeRunning] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<ClaudeRun | null>(null);
  const [testsNonce, setTestsNonce] = useState(0);
  const [source, setSource] = useState<Source | null>(null);
  const [palette, setPalette] = useState(false);
  const [form, setForm] = useState<CommandInfo | null>(null);
  const [dockWidth, setDockWidth] = usePref("dockWidth");
  const [dragW, setDragW] = useState<number | null>(null);
  const dock = useDock(route.screen);
  const bar = useTopBarSlots();
  const running = useRunningJobs();

  const testsChanged = useCallback(() => setTestsNonce((n) => n + 1), []);
  const { refreshInfo, closeProject: close } = p;
  const closeProject = useCallback(() => {
    close();
    testsChanged();
  }, [close, testsChanged]);
  const openPalette = useCallback(() => setPalette(true), []);
  useShellEvents(testsChanged);

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
      openSource: setSource,
      askClaude: dock.askClaude,
      runInDock: dock.runInDock,
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
      testsChanged,
      refreshInfo,
      closeProject,
      dock.askClaude,
      dock.runInDock,
      openPalette,
    ],
  );

  const runCommand = useCallback(
    (c: CommandInfo) => {
      if (hasInput(c)) {
        setForm(c);
        return;
      }
      execute(client, c.name as CommandName, {} as never, { invalidates: c.mutates ? "project" : "none" })
        .then((r) => {
          const jobId = (r as { jobId?: string } | null)?.jobId;
          toast({
            kind: "ok",
            title: jobId ? `${c.name} started` : `${c.name} done`,
            detail: jobId ? "Follow it in Jobs." : undefined,
          });
          if (c.mutates) testsChanged();
        })
        .catch((e) => errorToast(e, `${c.name} failed`));
    },
    [client, testsChanged],
  );

  const actions = useMemo(() => paletteActions(navigate, toggleDock), [navigate, toggleDock]);

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
  const shownDock = dragW ?? dockWidth ?? DOCK.start;

  return (
    <AppContext.Provider value={app}>
      {route.screen === "setup" ? (
        p.booted && <Screens screen="setup" />
      ) : (
        <div {...stylex.props(styles.app)}>
          <Rail counts={counts} kit={p.mock} />
          <main key={p.dir ?? ""} {...stylex.props(styles.frame, !dock.folded && styles.frameOpen)}>
            <TopBarContext.Provider value={bar.value}>
              <TopBar title={TITLES[route.screen]} onPalette={openPalette} slots={bar} />
              <ServerLost />
              <div {...stylex.props(styles.screen)}>{p.booted && <Screens screen={route.screen} />}</div>
            </TopBarContext.Provider>
          </main>
          {!dock.folded && (
            <span {...stylex.props(styles.edge)}>
              <ResizeHandle
                label="Resize the Claude panel"
                side="left"
                value={shownDock}
                min={DOCK.min}
                max={DOCK.max}
                defaultValue={DOCK.start}
                onChange={setDragW}
                onCommit={(w) => {
                  setDockWidth(w);
                  setDragW(null);
                }}
              />
            </span>
          )}
          <div
            {...stylex.props(styles.dock, !dock.folded && styles.dockOpen)}
            style={dock.folded ? undefined : ({ "--dock-size": `${shownDock}px` } as CSSProperties)}
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
          onAsk={dock.askDocs}
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
      <Toaster />
      <DesktopBridge booted={p.booted} />
    </AppContext.Provider>
  );
}
