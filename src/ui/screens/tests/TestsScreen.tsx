import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CredsStatus, LocalTestRef } from "../../../core/types.ts";
import { NoProject } from "../../components/shell/NoProject.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { ResizeHandle } from "../../components/ui/ResizeHandle.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { project } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { keepDraft } from "../../lib/drafts.ts";
import { usePaneWidth } from "../../lib/panes.ts";
import { errorToast } from "../../lib/toast.ts";
import { border, color, size, space } from "../../styles/tokens.stylex.ts";
import { ConnectAtlassian } from "../settings/ConnectAtlassian.tsx";
import { useNewTest } from "./list/newTest.ts";
import type { Listed } from "./list/tree.ts";
import { PullPane } from "./PullPane.tsx";
import { abandonPulls, cancelPull, onPullLanded, startPull, usePullStage, usePulls, watchPull } from "./pulls.ts";
import { TestEditor } from "./TestEditor.tsx";
import { TestList } from "./TestList.tsx";

export const NARROW = 900;
const SIDEBAR = { min: 260, max: 480, initial: 320 };

const styles = stylex.create({
  screen: { display: "flex", flex: 1, minWidth: 0, minHeight: 0, height: "100%", backgroundColor: color.canvas },
  side: {
    boxSizing: "border-box",
    position: "relative",
    flex: "none",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    borderInlineEndStyle: "solid",
    borderInlineEndWidth: border.width,
    borderInlineEndColor: color.border,
  },
  edge: { position: "absolute", top: 0, bottom: 0, right: 0, display: "flex" },
  main: { flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" },
  pane: {
    boxSizing: "border-box",
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    padding: space.s7,
  },
  top: { alignItems: "flex-start" },
  connect: { width: "100%", maxWidth: size.modalMd, display: "flex", flexDirection: "column", gap: space.s4 },
  title: { margin: 0 },
});

// ponytail: the narrow breakpoint is a presentation fact of the window, read from its width
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return narrow;
}

// ponytail: Tests — the list of the project's tests on the left (a drawer when the window is narrow), the open test, a
// Jira test being pulled, or what to do when none is open
export function TestsScreen() {
  const app = useApp();
  const activeId = app.route.screen === "tests" ? (app.route.arg ?? "") : "";
  const dir = app.info?.dir;
  const has = !!project();
  const listQ = useRead("tests.list", {}, { enabled: has });
  const refs = (Array.isArray(listQ.data) ? listQ.data : []) as LocalTestRef[];
  const side = usePaneWidth("sidebarWidth", SIDEBAR);
  const narrow = useNarrow();
  const [drawer, setDrawer] = useState(false);
  const pulls = usePulls();
  // ponytail: while Jira or Xray access is incomplete the empty pane is the connection form (Xray Editor shows its
  // « Connect to Jira and Xray » screen in place of the editor until both files are complete)
  const credsQ = useRead("system.credentials", {}, { enabled: has });
  const creds = (credsQ.data as { status?: CredsStatus } | undefined)?.status;
  const access = creds ? creds.jira.complete && creds.xray.complete : null;
  const navigate = app.navigate;

  // ponytail: an adapter until every screen writes through the data layer — the shell's « tests changed » reads the
  // list again (Review, Generate and the dock still call it after their runs)
  const nonce = useRef(app.testsNonce);
  // biome-ignore lint/correctness/useExhaustiveDependencies: asked again when the shell says the tests changed
  useEffect(() => {
    if (nonce.current === app.testsNonce) return;
    nonce.current = app.testsNonce;
    if (has) void listQ.refetch();
  }, [app.testsNonce]);

  useEffect(() => {
    if (listQ.error) errorToast(listQ.error, "Could not list the tests");
  }, [listQ.error]);

  const reload = useCallback(async () => {
    const r = await listQ.refetch();
    return (Array.isArray(r.data) ? r.data : []) as LocalTestRef[];
  }, [listQ]);

  const lastDir = useRef(dir);
  useEffect(() => {
    const was = lastDir.current;
    lastDir.current = dir;
    if (!dir) return;
    const now = project();
    abandonPulls((d) => d === now);
    if (was && was !== dir) navigate("tests");
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

  // ponytail: only validated tests live in Tests — a generated test still in review opens in Review, and Tests forgets
  // it (else the rail, which reopens what was open on a screen, would send every visit of Tests back to Review)
  useEffect(() => {
    const ref = refs.find((r) => r.id === activeId);
    if (!(ref as Listed | undefined)?.awaiting) return;
    keepDraft("route.tests", undefined);
    navigate("review", activeId);
  }, [refs, activeId, navigate]);

  useEffect(() => {
    if (!narrow) setDrawer(false);
  }, [narrow]);

  const open = (id: string) => {
    setDrawer(false);
    navigate("tests", id);
  };

  // ponytail: no test is open here, so New test follows the list's rule with no open folder (the Jira folder picked, else
  // the root)
  const { create: newTest } = useNewTest(undefined, async (id) => {
    await reload();
    open(id);
  });

  const list = (
    <TestList
      key={dir ?? ""}
      refs={refs}
      loading={has && listQ.isPending}
      activeId={activeId}
      onOpen={open}
      onReload={reload}
      pulling={pulls.filter((p) => !p.error).map((p) => p.key)}
      onPull={(key, summary) => {
        startPull(key, summary);
        open(key);
      }}
      onDeleted={(id) => {
        if (id === activeId) navigate("tests");
        void reload();
      }}
    />
  );

  const pull = pulls.find((p) => p.key === activeId);
  const stage = usePullStage(pull?.jobId);
  const others = pulls.filter((p) => !p.error && p.key !== activeId);
  const lead = narrow ? (
    <Button
      variant="quiet"
      size="sm"
      iconOnly
      icon="menu"
      label="Show test list"
      expanded={drawer}
      onClick={() => setDrawer((d) => !d)}
    />
  ) : undefined;

  return (
    <div {...stylex.props(styles.screen)}>
      {!narrow && (
        <div {...stylex.props(styles.side)} style={{ width: side.width }}>
          {list}
          <span {...stylex.props(styles.edge)}>
            <ResizeHandle label="Resize the test list" {...side.handle} />
          </span>
        </div>
      )}
      {narrow && drawer && (
        <Modal title="Tests" drawer="left" flush onClose={() => setDrawer(false)}>
          {list}
        </Modal>
      )}
      <main {...stylex.props(styles.main)}>
        {pull ? (
          <>
            {lead}
            <PullPane
              pull={{ ...pull, ...stage }}
              others={others}
              onCancel={() => {
                cancelPull(pull);
                navigate("tests");
              }}
              onRetry={() => {
                cancelPull(pull);
                startPull(pull.key, pull.summary);
              }}
              onBack={() => {
                cancelPull(pull);
                navigate("tests");
              }}
            />
          </>
        ) : activeId ? (
          <TestEditor key={activeId} testId={activeId} lead={lead} onOpen={open} onSaved={() => {}} />
        ) : (
          <>
            {lead}
            <div {...stylex.props(styles.pane, has && access === false && styles.top)}>
              {!has ? (
                <NoProject text="Tests live in a project folder, next to the documents they come from. Open one, or start a new project." />
              ) : access === false ? (
                <div {...stylex.props(styles.connect)}>
                  <h2 {...stylex.props(type.title, styles.title)}>Connect to Jira and Xray</h2>
                  <ConnectAtlassian
                    lead="Testimus pulls and pushes your tests with your own Jira and Xray access — the same files Xray Editor uses."
                    onStatus={() => void credsQ.refetch()}
                  />
                </div>
              ) : listQ.isSuccess && !refs.length ? (
                <EmptyState
                  icon="tests"
                  title="No test yet"
                  text="Generate tests from a document, or write one by hand."
                  actions={
                    <>
                      <Button
                        variant="primary"
                        icon="generate"
                        label="Generate tests"
                        onClick={() => navigate("generate")}
                      />
                      <Button icon="plus" label="New test" onClick={() => void newTest()} />
                    </>
                  }
                />
              ) : (
                <EmptyState
                  icon="tests"
                  title="No test open"
                  text={
                    narrow
                      ? "Open the test list to pick one; a Jira test is pulled the first time you open it."
                      : "Pick one on the left, or start a new one. A Jira test is pulled the first time you open it."
                  }
                  actions={<Button icon="plus" label="New test" onClick={() => void newTest()} />}
                />
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
