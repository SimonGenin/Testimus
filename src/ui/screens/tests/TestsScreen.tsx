import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { awaitsReview, type CredsStatus, type LocalTestRef } from "../../../core/types.ts";
import { project as apiProject, call } from "../../api.ts";
import { DragEdge, Icon } from "../../components/legacy/index.ts";
import { Activity } from "../../components/shell/Activity.tsx";
import { useApp } from "../../lib/app.ts";
import { cx } from "../../lib/format.ts";
import { useSideWidth } from "../../lib/sideWidth.ts";
import { errorToast } from "../../lib/toast.ts";
import { ConnectAtlassian } from "../settings/ConnectAtlassian.tsx";
import { PullPane } from "./PullPane.tsx";
import { abandonPulls, cancelPull, onPullLanded, startPull, usePulls, watchPull } from "./pulls.ts";
import { TestEditor } from "./TestEditor.tsx";
import { TestList } from "./TestList.tsx";

export const NARROW = 900;
export const SIDEBAR_MIN = 240;
export const SIDEBAR_MAX = 480;

export function TestsScreen() {
  const app = useApp();
  const activeId = app.route.screen === "tests" ? (app.route.arg ?? "") : "";
  const [refs, setRefs] = useState<LocalTestRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [shownWidth, edge] = useSideWidth("testimus.sidebarWidth", SIDEBAR_MIN, SIDEBAR_MAX, "before");
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
  const [drawer, setDrawer] = useState(false);
  const pulls = usePulls();
  const dir = app.info?.dir;
  // ponytail: while Jira or Xray access is incomplete the empty pane is the connection form (Xray Editor shows its
  // « Connect to Jira and Xray » screen in place of the editor until both files are complete)
  const [access, setAccess] = useState<boolean | null>(null);
  const accessOf = (s: CredsStatus) => setAccess(s.jira.complete && s.xray.complete);
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again when the project changes
  useEffect(() => {
    call<{ status: CredsStatus }>("system.credentials", {})
      .then((r) => r?.status && accessOf(r.status))
      .catch(() => setAccess(null));
  }, [dir]);
  const navigate = app.navigate;

  const reload = useCallback(async () => {
    // ponytail: a list asked for by the project being left never lands in the one now on screen
    const asked = apiProject();
    // ponytail: before a project is open (the first launch, on its way to the setup screen) there is nothing to list
    if (!asked) {
      setLoading(false);
      return [];
    }
    try {
      const r = await call<LocalTestRef[]>("tests.list", {});
      const list = Array.isArray(r) ? r : [];
      if (apiProject() === asked) setRefs(list);
      return list;
    } catch (e) {
      if (apiProject() === asked) errorToast(e, "Could not list the tests");
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reload when the project or a run changes the tests
  useEffect(() => {
    void reload();
  }, [reload, app.testsNonce, dir]);

  const lastDir = useRef(dir);
  useEffect(() => {
    const was = lastDir.current;
    lastDir.current = dir;
    if (!dir) return;
    const now = apiProject();
    abandonPulls((d) => d === now);
    if (was && was !== dir) {
      setRefs([]);
      setLoading(true);
      navigate("tests");
    }
  }, [dir, navigate]);

  useEffect(() => {
    watchPull(activeId);
    return () => watchPull("");
  }, [activeId]);

  useEffect(
    () =>
      onPullLanded(async (key, watched) => {
        const list = await reload();
        const ref = list.find((r) => r.key === key);
        if (watched && ref && ref.id !== key) navigate("tests", ref.id);
      }),
    [reload, navigate],
  );

  // ponytail: only validated tests live in Tests — a generated test still in review opens in Review
  useEffect(() => {
    const ref = refs.find((r) => r.id === activeId);
    if (ref && awaitsReview(ref)) navigate("review", activeId);
  }, [refs, activeId, navigate]);

  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!narrow) setDrawer(false);
  }, [narrow]);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const open = (id: string) => {
    setDrawer(false);
    navigate("tests", id);
  };

  const pullKey = (key: string, summary: string) => {
    startPull(key, summary);
    open(key);
  };

  const deleted = (id: string) => {
    if (id === activeId) navigate("tests");
    void reload();
  };

  const pull = pulls.find((p) => p.key === activeId);
  const others = pulls.filter((p) => !p.error && p.key !== activeId);

  return (
    <div
      className={cx("tests-screen", narrow && "is-narrow")}
      style={shownWidth ? ({ "--tside-w": `${shownWidth}px` } as CSSProperties) : undefined}
    >
      <TestList
        key={dir ?? ""}
        refs={refs}
        loading={loading}
        activeId={activeId}
        onOpen={open}
        onReload={reload}
        pulling={pulls.filter((p) => !p.error).map((p) => p.key)}
        onPull={pullKey}
        onDeleted={deleted}
        open={narrow && drawer}
        onCloseDrawer={() => setDrawer(false)}
      />
      {!narrow && <DragEdge className="tside-edge" label="Resize the test list" {...edge} />}
      {narrow && drawer && <div className="tside-scrim" aria-hidden="true" onClick={() => setDrawer(false)} />}
      <main className="tests-main">
        {narrow && (
          <div className="tests-bar">
            <button
              type="button"
              className="btn btn-quiet btn-sm iconbtn tside-toggle"
              aria-label="Show test list"
              title="Show test list"
              aria-expanded={drawer}
              onClick={() => setDrawer((d) => !d)}
            >
              <span aria-hidden="true">☰</span>
            </button>
            <span className="spacer" />
            {!drawer && <Activity />}
          </div>
        )}
        {pull ? (
          <PullPane
            pull={pull}
            others={others}
            onCancel={() => {
              cancelPull(pull.key);
              navigate("tests");
            }}
            onRetry={() => {
              cancelPull(pull.key);
              startPull(pull.key, pull.summary);
            }}
            onBack={() => {
              cancelPull(pull.key);
              navigate("tests");
            }}
          />
        ) : activeId ? (
          <TestEditor
            key={activeId}
            testId={activeId}
            onOpen={open}
            onSaved={(ref) => setRefs((list) => list.map((r) => (r.id === ref.id ? { ...r, ...ref } : r)))}
          />
        ) : access === false ? (
          <div className="editor-empty editor-connect">
            <h2 className="h">Connect to Jira and Xray</h2>
            <ConnectAtlassian
              lead="Testimus pulls and pushes your tests with your own Jira and Xray access — the same files Xray Editor uses."
              onStatus={accessOf}
            />
          </div>
        ) : (
          <div className="editor-empty">
            <Icon name="tests" size={40} />
            <h2 className="h">No test open</h2>
            <p className="muted">
              Pick a test on the left. Local tests open straight from the project folder; a Jira test is pulled the
              first time you open it.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
