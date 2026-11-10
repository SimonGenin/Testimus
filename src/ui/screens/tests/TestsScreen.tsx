import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useRef } from "react";
import type { CredsStatus, LocalTestRef } from "../../../core/types.ts";
import { useClaudeTab } from "../../components/claude/ClaudeTab.tsx";
import { NoProject } from "../../components/shell/NoProject.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { type } from "../../components/ui/type.ts";
import { Workspace } from "../../components/ui/workspace/Workspace.tsx";
import { useApp } from "../../lib/app.ts";
import { project } from "../../lib/data/client.ts";
import { useRead } from "../../lib/data/query.ts";
import { keepDraft } from "../../lib/drafts.ts";
import { usePref } from "../../lib/prefs.ts";
import { errorToast } from "../../lib/toast.ts";
import { column, layoutOf, locate, section, sectionOf } from "../../lib/workspace/layout.ts";
import { useWorkspace } from "../../lib/workspace/useWorkspace.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { ConnectAtlassian } from "../settings/ConnectAtlassian.tsx";
import { useNewTest } from "./list/newTest.ts";
import type { Listed } from "./list/tree.ts";
import { useListView } from "./list/useListView.ts";
import { PullPane } from "./PullPane.tsx";
import { abandonPulls, cancelPull, onPullLanded, startPull, usePullStage, usePulls, watchPull } from "./pulls.ts";
import { TestEditor } from "./TestEditor.tsx";
import { TestList } from "./TestList.tsx";

// ponytail: the tests on the left, the one open in the middle, Claude folded on the right; the list's own layouts
// (folders and tests side by side) want the list's column widened, which its edge does and the layout keeps
const LAYOUT = layoutOf(
  column(320, section(["list"])),
  column(null, section(["test"])),
  column(400, section(["claude"], true)),
);

// ponytail: folders and tests side by side (Jira's, or the local ones) need about two lists' width: choosing it widens
// the list's column to it, leaving it narrows a column wider than one list back
const LIST = { one: 320, oneMax: 480, two: 640 };

const styles = stylex.create({
  screen: { display: "flex", flex: 1, minWidth: 0, minHeight: 0, height: "100%", flexDirection: "column" },
  side: { flex: 1, display: "flex", flexDirection: "column", minHeight: 0 },
  main: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.canvas,
  },
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

// ponytail: Tests — the project's tests, the open test (a Jira test being pulled, or what to do when none is open) and
// Claude, each a tab of the screen's sections
export function TestsScreen() {
  const app = useApp();
  const activeId = app.route.screen === "tests" ? (app.route.arg ?? "") : "";
  const dir = app.info?.dir;
  const has = !!project();
  const listQ = useRead("tests.list", {}, { enabled: has });
  const refs = (Array.isArray(listQ.data) ? listQ.data : []) as LocalTestRef[];
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

  const open = (id: string) => navigate("tests", id);

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

  const work = pull ? (
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
  ) : activeId ? (
    <TestEditor key={activeId} testId={activeId} onOpen={open} onSaved={() => {}} />
  ) : (
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
              <Button variant="primary" icon="generate" label="Generate tests" onClick={() => navigate("generate")} />
              <Button icon="plus" label="New test" onClick={() => void newTest()} />
            </>
          }
        />
      ) : (
        <EmptyState
          icon="tests"
          title="No test open"
          text="Pick one in the list, or start a new one. A Jira test is pulled the first time you open it."
          actions={<Button icon="plus" label="New test" onClick={() => void newTest()} />}
        />
      )}
    </div>
  );

  const tab = useListView().tab;
  const [jiraLayout] = usePref("jiraLayout");
  const [localLayout] = usePref("localLayout");
  const jiraOn = !!app.info?.project?.jiraProject && !app.info.project.jiraOffline;
  const wide =
    (tab === "jira" && jiraOn && jiraLayout === "columns") ||
    (tab === "local" && localLayout === "columns" && refs.length > 0);

  const claude = useClaudeTab();
  const ws = useWorkspace({
    pref: "layoutTests",
    label: "Tests",
    defaults: LAYOUT,
    tabs: [
      {
        id: "list",
        label: "Tests",
        icon: "tree",
        count: refs.length || undefined,
        content: <div {...stylex.props(styles.side)}>{list}</div>,
      },
      {
        id: "test",
        label: "Test",
        icon: "tests",
        main: true,
        content: <main {...stylex.props(styles.main)}>{work}</main>,
      },
      claude,
    ],
  });

  const latest = useRef(ws);
  latest.current = ws;
  const was = useRef<boolean | null>(null);
  useEffect(() => {
    const before = was.current;
    was.current = wide;
    if (before === wide || (before === null && !wide)) return;
    const { layout, resizeColumns } = latest.current;
    const at = locate(layout, sectionOf(layout, "list")?.id ?? "");
    const width = at ? layout.columns[at.column].width : null;
    if (!at || width === null) return;
    if (wide && width < LIST.two) resizeColumns([{ column: at.column, width: LIST.two }], true);
    else if (!wide && width > LIST.oneMax) resizeColumns([{ column: at.column, width: LIST.one }], true);
  }, [wide]);

  return (
    <div {...stylex.props(styles.screen)}>
      <Workspace ws={ws} />
    </div>
  );
}
