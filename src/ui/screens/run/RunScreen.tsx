import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { ExportRun } from "./ExportRun.tsx";
import { ImportRun } from "./ImportRun.tsx";
import { NewRun } from "./NewRun.tsx";
import { RunDetail } from "./RunDetail.tsx";
import { RunExec } from "./RunExec.tsx";
import { RunOverview } from "./RunOverview.tsx";
import { routeOf, TEST_VIEW, type TestView } from "./runs.ts";

const styles = stylex.create({
  screen: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.surface,
  },
  none: { boxSizing: "border-box", flex: 1, display: "flex", padding: space.s7 },
  loading: {
    boxSizing: "border-box",
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    padding: space.s7,
  },
});

// ponytail: the testers' screen, in sections — the runs, a run (its progress, its tests), what it found; a test opens
// to be run in sections of its own. How the tests are filtered and sorted is one view, kept from
// the run to its tests and back; Claude reads the run open here
export function RunScreen() {
  const app = useApp();
  const { run: slug, test } = routeOf(app.route.screen === "run" ? app.route.arg : undefined);
  const [creating, setCreating] = useState(false);
  const [pages, setPages] = useState<"export" | "import" | null>(null);
  const [view, setView] = useState<TestView>(TEST_VIEW);
  const runs = useRead("runs.list", {});
  const list = runs.data?.runs;
  const me = runs.data?.user ?? "";
  const named = list?.some((r) => r.slug === slug) ? slug : "";
  const shown = named || list?.find((r) => !r.finished)?.slug || list?.[0]?.slug || "";
  const run = useRead("runs.show", { run: shown }, { enabled: !!shown });
  const open = (s: string, t?: string) => app.navigate("run", t ? `${s}/${t}` : s);
  const playing = test && run.data?.slug === shown ? run.data.tests.find((t) => t.id === test) : undefined;
  const { setFocus, askClaude } = app;
  const overview = !playing && run.data?.slug === shown ? run.data : undefined;

  useEffect(() => {
    if (overview) setFocus({ testId: "", summary: overview.name, step: null, run: overview.slug });
  }, [setFocus, overview?.slug, overview?.name, overview]);
  useEffect(() => () => setFocus(null), [setFocus]);

  const newRun = <Button variant="primary" size="sm" label="New run…" onClick={() => setCreating(true)} />;
  const importRun = <Button size="sm" icon="upload" label="Import results…" onClick={() => setPages("import")} />;
  const dialog = (
    <>
      {creating && (
        <NewRun
          onClose={() => setCreating(false)}
          onMade={(s) => {
            setCreating(false);
            open(s);
          }}
        />
      )}
      {pages === "export" && run.data && <ExportRun run={run.data} onClose={() => setPages(null)} />}
      {pages === "import" && (
        <ImportRun
          onClose={() => setPages(null)}
          onDone={(s) => {
            setPages(null);
            open(s);
          }}
        />
      )}
    </>
  );

  if (playing && run.data)
    return (
      <div {...stylex.props(styles.screen)}>
        <RunExec
          key={playing.id}
          run={run.data}
          test={playing}
          view={view}
          onView={setView}
          me={me}
          onGo={(t) => open(shown, t)}
          onBack={() => open(shown)}
        />
      </div>
    );

  return (
    <div {...stylex.props(styles.screen)}>
      <ScreenHeader title="Run" crumbs={overview ? [overview.name] : []}>
        {newRun}
      </ScreenHeader>
      <RunOverview
        runs={list}
        shown={shown}
        overview={overview}
        onOpen={(s) => open(s)}
        onOpenTest={(t) => open(shown, t)}
        onAsk={(prompt) => askClaude("run", prompt)}
        main={
          runs.error ? (
            <div {...stylex.props(styles.none)}>
              <Banner tone="danger" title="Could not read the runs">
                {runs.error.message}
              </Banner>
            </div>
          ) : run.error ? (
            <div {...stylex.props(styles.none)}>
              <Banner tone="danger" title="Could not read this run">
                {run.error.message}
              </Banner>
            </div>
          ) : overview ? (
            <RunDetail
              run={overview}
              view={view}
              onView={setView}
              me={me}
              onOpenTest={(t) => open(shown, t)}
              actions={
                <>
                  <Button size="sm" icon="download" label="Export as pages…" onClick={() => setPages("export")} />
                  {importRun}
                </>
              }
            />
          ) : list && !list.length ? (
            <div {...stylex.props(styles.none)}>
              <EmptyState
                icon="play"
                title="No run yet"
                text="Make a run from a folder, a review state, labels or test keys: the tests are frozen as they are, then played one by one."
                actions={
                  <>
                    {newRun}
                    {importRun}
                  </>
                }
              />
            </div>
          ) : (
            <div {...stylex.props(styles.loading)}>
              <Skeleton width="40%" />
              <Skeleton width="70%" />
              <Skeleton width="90%" />
              <Loading read={list ? "runs.show" : "runs.list"} />
            </div>
          )
        }
      />
      {dialog}
    </div>
  );
}
