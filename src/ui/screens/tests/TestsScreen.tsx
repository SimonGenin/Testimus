import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import type { LocalTestRef } from "../../../core/types.ts";
import { project as apiProject, call } from "../../api.ts";
import { Activity } from "../../components/shell/Activity.tsx";
import { DragEdge, Icon } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { cx } from "../../lib/format.ts";
import { addRecent } from "../../lib/recent.ts";
import { errorToast } from "../../lib/toast.ts";
import { PullPane } from "./PullPane.tsx";
import { abandonPulls, cancelPull, onPullLanded, startPull, usePulls, watchPull } from "./pulls.ts";
import { TestEditor } from "./TestEditor.tsx";
import { TestList } from "./TestList.tsx";

export const NARROW = 900;
export const SIDEBAR_MIN = 240;
export const SIDEBAR_MAX = 480;
const WIDTH_KEY = "testimus.sidebarWidth";

const readWidth = (): number | null => {
  try {
    const v = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(v) && v >= SIDEBAR_MIN && v <= SIDEBAR_MAX ? v : null;
  } catch {
    return null;
  }
};

const writeWidth = (w: number | null) => {
  try {
    if (w === null) localStorage.removeItem(WIDTH_KEY);
    else localStorage.setItem(WIDTH_KEY, String(w));
  } catch {}
};

export function TestsScreen() {
  const app = useApp();
  const activeId = app.route.screen === "tests" ? (app.route.arg ?? "") : "";
  const [refs, setRefs] = useState<LocalTestRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [width, setWidth] = useState(readWidth);
  const [dragW, setDragW] = useState<number | null>(null);
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
  const [drawer, setDrawer] = useState(false);
  const pulls = usePulls();
  const dir = app.info?.dir;
  const navigate = app.navigate;

  const reload = useCallback(async () => {
    // ponytail: a list asked for by the project being left never lands in the one now on screen
    const asked = apiProject();
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

  const recorded = useRef("");
  useEffect(() => {
    if (!activeId || recorded.current === activeId || !refs.some((r) => r.id === activeId)) return;
    recorded.current = activeId;
    addRecent(activeId);
  }, [activeId, refs]);

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
  const shownWidth = dragW ?? width;

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
      {!narrow && (
        <DragEdge
          className="tside-edge"
          label="Resize the test list"
          target={(edge) => edge.previousElementSibling as HTMLElement}
          width={(dx, w) => Math.min(Math.max(w + dx, SIDEBAR_MIN), SIDEBAR_MAX)}
          onWidth={setDragW}
          onCommit={() => {
            if (dragW === null) return;
            setWidth(dragW);
            writeWidth(dragW);
            setDragW(null);
          }}
          onReset={() => {
            setDragW(null);
            setWidth(null);
            writeWidth(null);
          }}
        />
      )}
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
