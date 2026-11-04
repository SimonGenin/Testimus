import * as stylex from "@stylexjs/stylex";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Spinner } from "../../components/ui/Spinner.tsx";
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
import type { Pull } from "./pulls.ts";

const styles = stylex.create({
  pane: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: space.s7,
  },
  panel: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: size.modalSm,
    display: "flex",
    flexDirection: "column",
    gap: space.s4,
    padding: space.s6,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
    boxShadow: shadow.s1,
  },
  titles: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  key: { fontFamily: fontFamily.mono, fontSize: fontSize.code, color: color.textMuted },
  title: {
    margin: 0,
    fontSize: fontSize.title,
    lineHeight: lineHeight.title,
    fontWeight: fontWeight.semibold,
    overflowWrap: "anywhere",
  },
  line: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    color: color.textMuted,
    overflowWrap: "anywhere",
  },
  foot: { display: "flex", alignItems: "center", gap: space.s3 },
  grow: { flex: 1 },
  note: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
  error: { margin: 0, overflowWrap: "anywhere" },
});

// the pane of a Jira test being pulled into the project: its key and summary, what the pull is doing, Cancel; failed,
// why and Retry
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
  if (pull.error)
    return (
      <div {...stylex.props(styles.pane)}>
        <div {...stylex.props(styles.panel)}>
          <Banner
            tone="danger"
            title={`Could not pull ${pull.key}`}
            actions={
              <>
                <Button variant="primary" size="sm" icon="refresh" label="Retry" onClick={onRetry} />
                <Button size="sm" icon="arrow-left" label="Back" onClick={onBack} />
              </>
            }
          >
            <p {...stylex.props(styles.error)}>{pull.error}</p>
          </Banner>
        </div>
      </div>
    );
  // ponytail: a pull that has not reported yet is either still reaching Jira or queued behind the
  // others the core is already working on (it runs 3 at a time)
  const queued = !pull.message && others.some((p) => p.message);
  const line = pull.message ?? (queued ? "waiting for a free slot… (3 pulls at a time)" : "contacting Jira…");
  const summary = pull.read?.summary || pull.summary;
  const imgs = pull.phase === "images" ? pull.images : undefined;
  return (
    <div aria-busy="true" {...stylex.props(styles.pane)}>
      <section aria-label={`Pulling ${pull.key}`} {...stylex.props(styles.panel)}>
        <div {...stylex.props(styles.titles)}>
          <span {...stylex.props(styles.key)}>
            {pull.key} · {queued ? "queued" : "pulling from Jira"}
          </span>
          {summary ? <h2 {...stylex.props(styles.title)}>{summary}</h2> : <Skeleton kind="title" width="70%" />}
        </div>
        <div {...stylex.props(styles.line)}>
          <Spinner size="sm" />
          <span role="status" aria-label="Pull progress">
            {line}
          </span>
        </div>
        <Progress
          label={imgs?.total ? "Images downloaded" : "Pulling"}
          value={imgs?.total ? (imgs.done / imgs.total) * 100 : null}
          detail={imgs?.total ? `${imgs.done} of ${imgs.total} images` : undefined}
        />
        <div {...stylex.props(styles.foot)}>
          <Button icon="stop" label="Cancel" onClick={onCancel} />
          <span {...stylex.props(styles.grow)} />
          {others.length > 0 && (
            <span {...stylex.props(styles.note)}>{others.length} more pulling in the background</span>
          )}
        </div>
      </section>
    </div>
  );
}
