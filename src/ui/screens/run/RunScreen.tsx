import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { border, breakpoint, color, size, space } from "../../styles/tokens.stylex.ts";
import { NewRun } from "./NewRun.tsx";
import { RunDetail } from "./RunDetail.tsx";
import { RunExec } from "./RunExec.tsx";
import { RunList } from "./RunList.tsx";
import { routeOf } from "./runs.ts";

const styles = stylex.create({
  screen: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: color.surface,
  },
  body: {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: { default: "row", [breakpoint.narrow]: "column" },
  },
  list: {
    boxSizing: "border-box",
    flex: "none",
    width: { default: size.sidebar, [breakpoint.narrow]: "auto" },
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    paddingBlock: space.s4,
    paddingInline: space.s3,
    borderInlineEndStyle: "solid",
    borderInlineEndWidth: border.width,
    borderInlineEndColor: color.border,
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

// ponytail: the testers' screen — the runs on the left, a run and its tests on the right; a test opens full width to
// be run, with its comments beside it
export function RunScreen() {
  const app = useApp();
  const { run: slug, test } = routeOf(app.route.screen === "run" ? app.route.arg : undefined);
  const [creating, setCreating] = useState(false);
  const runs = useRead("runs.list", {});
  const list = runs.data?.runs;
  const shown = slug || list?.find((r) => !r.finished)?.slug || list?.[0]?.slug || "";
  const run = useRead("runs.show", { run: shown }, { enabled: !!shown });
  const open = (s: string, t?: string) => app.navigate("run", t ? `${s}/${t}` : s);
  const playing = test && run.data?.slug === shown ? run.data.tests.find((t) => t.id === test) : undefined;

  const newRun = <Button variant="primary" size="sm" label="New run…" onClick={() => setCreating(true)} />;
  const dialog = creating && (
    <NewRun
      onClose={() => setCreating(false)}
      onMade={(s) => {
        setCreating(false);
        open(s);
      }}
    />
  );

  if (playing && run.data)
    return (
      <div {...stylex.props(styles.screen)}>
        <RunExec
          key={playing.id}
          run={run.data}
          test={playing}
          onGo={(t) => open(shown, t)}
          onBack={() => open(shown)}
        />
      </div>
    );

  return (
    <div {...stylex.props(styles.screen)}>
      <ScreenHeader title="Run">{newRun}</ScreenHeader>
      <div {...stylex.props(styles.body)}>
        {(!list || list.length > 0) && (
          <nav aria-label="Runs" {...stylex.props(styles.list)}>
            <RunList runs={list} selected={shown} onOpen={(s) => open(s)} />
          </nav>
        )}
        {runs.error ? (
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
        ) : run.data && run.data.slug === shown ? (
          <RunDetail run={run.data} onOpenTest={(t) => open(shown, t)} />
        ) : list && !list.length ? (
          <div {...stylex.props(styles.none)}>
            <EmptyState
              icon="play"
              title="No run yet"
              text="Make a run from a folder, a review state, labels or test keys: the tests are frozen as they are, then played one by one."
              actions={newRun}
            />
          </div>
        ) : (
          <div {...stylex.props(styles.loading)}>
            <Skeleton width="40%" />
            <Skeleton width="70%" />
            <Skeleton width="90%" />
          </div>
        )}
      </div>
      {dialog}
    </div>
  );
}
