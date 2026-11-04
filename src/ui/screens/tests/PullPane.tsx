import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon, type IconName } from "../../components/ui/Icon.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Timeline, type TimelineState } from "../../components/ui/Timeline.tsx";
import { plural } from "../../lib/format.ts";
import {
  border,
  color,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  shadow,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import type { Pull, PullRead } from "./pulls.ts";

const styles = stylex.create({
  pane: { flex: 1, minHeight: 0, overflow: "auto", display: "flex", justifyContent: "center", padding: space.s7 },
  panel: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: size.modalMd,
    alignSelf: "flex-start",
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    padding: space.s5,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
    boxShadow: shadow.s1,
  },
  head: { display: "flex", alignItems: "center", gap: space.s3 },
  titles: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s1 },
  title: { margin: 0, fontSize: fontSize.title, lineHeight: lineHeight.title, fontWeight: fontWeight.semibold },
  mono: { fontFamily: fontFamily.mono },
  time: { fontFamily: fontFamily.mono, fontSize: fontSize.code, color: color.textMuted },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    padding: space.s4,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
  },
  summary: { margin: 0, fontWeight: fontWeight.medium },
  where: { display: "flex", alignItems: "center", gap: space.s3, color: color.textMuted, fontSize: fontSize.small },
  facts: { display: "flex", flexWrap: "wrap", gap: space.s3, fontSize: fontSize.small, color: color.text },
  fact: { display: "inline-flex", alignItems: "center", gap: space.s1 },
  zero: { color: color.textSubtle },
  line: { fontFamily: fontFamily.mono, fontSize: fontSize.code, color: color.textMuted, overflowWrap: "anywhere" },
  foot: { display: "flex", alignItems: "center", gap: space.s3, color: color.textMuted, fontSize: fontSize.small },
  error: { margin: 0, overflowWrap: "anywhere" },
});

const elapsed = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

function useElapsed(from: number | undefined, running: boolean): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running || from === undefined) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [from, running]);
  return from === undefined ? null : elapsed(now - from);
}

// ponytail: the stage the pull is in — after the read it goes to the images, or straight to the write when Jira
// holds none; a pull still queued behind the others has not reached any
function stageOf(pull: Pull, queued: boolean): number {
  if (queued) return -1;
  if (pull.phase === "write") return 3;
  if (pull.phase === "images") return pull.images && pull.images.done < pull.images.total ? 2 : 3;
  if (pull.phase === "read") return pull.read?.images ? 2 : 3;
  return 0;
}

function Fact({ icon, n, word }: { icon: IconName; n: number; word: string }) {
  return (
    <span data-testid="pull-fact" {...stylex.props(styles.fact, n === 0 && styles.zero)}>
      <Icon name={icon} size="sm" />
      {n} {word}
      {n === 1 ? "" : "s"}
    </span>
  );
}

function TestCard({ read, summary }: { read?: PullRead; summary: string }) {
  if (!read)
    return (
      <div aria-hidden="true" data-testid="pull-card" {...stylex.props(styles.card)}>
        {summary ? <p {...stylex.props(styles.summary)}>{summary}</p> : <Skeleton kind="title" width="70%" />}
        <Skeleton width="45%" />
        <Skeleton lines={2} />
      </div>
    );
  return (
    <div data-testid="pull-card" {...stylex.props(styles.card)}>
      <p {...stylex.props(styles.summary)}>{read.summary || summary}</p>
      <div {...stylex.props(styles.where)}>
        <span {...stylex.props(styles.fact)}>
          <Icon name="folder" size="sm" />
          <span {...stylex.props(styles.mono)}>{read.folder || "/"}</span>
        </span>
        {read.status && <Badge label={read.status} tone="info" size="sm" />}
      </div>
      <div {...stylex.props(styles.facts)}>
        <Fact icon="tests" n={read.steps} word="step" />
        <Fact icon="image" n={read.images} word="image" />
        <Fact icon="lock" n={read.preconditions} word="precondition" />
        <Fact icon="link" n={read.covers} word="linked issue" />
        <Fact icon="tag" n={read.labels} word="label" />
      </div>
    </div>
  );
}

// the pane of a Jira test being pulled into the project: what it is, the four phases, Cancel; failed, why and Retry
export function PullPane({
  pull,
  others,
  onCancel,
  onRetry,
  onBack,
}: {
  pull: Pull;
  others: Pull[];
  onCancel: () => void;
  onRetry: () => void;
  onBack: () => void;
}) {
  const time = useElapsed(pull.startedAt, !pull.error);
  if (pull.error)
    return (
      <div {...stylex.props(styles.pane)}>
        <div {...stylex.props(styles.panel)}>
          <Banner
            tone="danger"
            title={`Could not pull ${pull.key}`}
            actions={
              <>
                <Button variant="primary" size="sm" label="Retry" onClick={onRetry} />
                <Button size="sm" label="Back" onClick={onBack} />
              </>
            }
          >
            <Badge label="Pull failed" tone="danger" icon="x-circle" size="sm" />
            <p {...stylex.props(styles.error)}>{pull.error}</p>
          </Banner>
        </div>
      </div>
    );
  // ponytail: a pull that has not reported yet is either still reaching Jira or queued behind the
  // others the core is already working on
  const queued = !pull.message && others.some((p) => p.message);
  const line = pull.message ?? (queued ? "waiting for a free slot…" : "contacting Jira…");
  const stage = stageOf(pull, queued);
  const state = (i: number): TimelineState => (i < stage ? "done" : i === stage ? "running" : "waiting");
  const read = pull.read;
  const imgs = pull.images ?? (read ? { done: 0, total: read.images } : undefined);
  const noImages = !!read && !read.images;
  return (
    <div aria-busy="true" {...stylex.props(styles.pane)}>
      <div {...stylex.props(styles.panel)}>
        <div {...stylex.props(styles.head)}>
          <Icon name="download" size="lg" />
          <div {...stylex.props(styles.titles)}>
            <Badge label={queued ? "Queued" : "From Jira"} tone={queued ? "neutral" : "info"} size="sm" />
            <h2 {...stylex.props(styles.title)}>
              Pulling <span {...stylex.props(styles.mono)}>{pull.key}</span>
            </h2>
          </div>
          {time && <span {...stylex.props(styles.time)}>{time}</span>}
        </div>
        <TestCard read={read} summary={pull.summary} />
        <Timeline
          label="Pull phases"
          items={[
            { key: "reach", state: state(0), title: stage > 0 ? "Jira reached" : "Reach Jira" },
            {
              key: "read",
              state: state(1),
              title: stage > 1 ? "Test read" : "Read the test",
              note: read ? plural(read.steps, "step") : undefined,
            },
            {
              key: "images",
              state: noImages ? "skipped" : state(2),
              title: noImages ? "No images" : "Download the images",
              note: imgs?.total ? `${imgs.done} / ${imgs.total}` : undefined,
              children:
                imgs?.total && !noImages ? (
                  <Progress label="Images downloaded" value={(imgs.done / imgs.total) * 100} />
                ) : undefined,
            },
            { key: "write", state: state(3), title: "Write test.md" },
          ]}
        />
        <div role="status" aria-label="Pull progress" {...stylex.props(styles.line)}>
          {line}
        </div>
        <div {...stylex.props(styles.foot)}>
          <Button label="Cancel" onClick={onCancel} />
          {others.length > 0 && <span>{others.length} more pulling in the background</span>}
        </div>
      </div>
    </div>
  );
}
