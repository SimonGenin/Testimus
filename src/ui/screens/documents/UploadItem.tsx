import * as stylex from "@stylexjs/stylex";
import { problemOf } from "../../components/shell/ProblemPanel.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import type { ListItemProps } from "../../components/ui/ListItem.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { useApp } from "../../lib/app.ts";
import { dismissUpload, type Upload } from "../../lib/uploads.ts";
import { fontFamily, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  lines: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0, flex: 1 },
  mono: { fontFamily: fontFamily.mono, overflow: "hidden", textOverflow: "ellipsis" },
  failure: { paddingInline: space.s3, paddingBottom: space.s3 },
  fix: { display: "block", marginTop: space.s1 },
});

const STEP: Record<Upload["job"], string> = { add: "Adding", convert: "Converting", index: "Indexing" };

const nowOf = (u: Upload): string | null =>
  u.phase === "reading" || u.phase === "adding" || u.phase === "converting"
    ? STEP[u.job]
    : u.phase === "indexing"
      ? "Indexing"
      : null;

// ponytail: a row of the list while its file is read, added, converted or indexed — the job's step, its last message
// and its progress; a finished row says so until the list shows the document again
export function uploadItem(u: Upload): ListItemProps {
  const now = nowOf(u);
  const msg = u.message === now ? "" : u.message;
  const sub = u.docId ?? (u.job === "index" ? "Search index" : "New document");
  return {
    title: u.name,
    tooltip: u.name,
    lead: <Icon name="documents" />,
    meta: (
      <span {...stylex.props(styles.lines)}>
        <span {...stylex.props(styles.mono)}>{sub}</span>
        {now ? (
          <Progress
            label={now}
            value={u.pct}
            detail={[now, msg, u.pct !== null ? `${u.pct}%` : ""].filter(Boolean).join(" · ")}
          />
        ) : u.phase === "done" ? (
          <span>
            <Badge size="sm" tone="success" icon="check" label={u.message} />
          </span>
        ) : (
          <span>
            <Badge
              size="sm"
              tone="danger"
              icon="x-circle"
              label={
                u.phase === "index-failed" ? "Indexing failed" : u.job === "convert" ? "Not converted" : "Not added"
              }
            />
          </span>
        )}
      </span>
    ),
  };
}

// ponytail: what stopped and what to do, under the list — the row stays as it was, the job stays in Jobs
export function UploadFailure({ u }: { u: Upload }) {
  const app = useApp();
  const p = problemOf(u.error ?? new Error(u.message));
  const index = u.phase === "index-failed";
  const dismiss = index
    ? `Dismiss the indexing failure of ${u.name}`
    : u.job === "convert"
      ? `Dismiss the conversion failure of ${u.name}`
      : `Dismiss ${u.name}`;
  const title = index ? "Indexing failed" : u.job === "convert" ? "Conversion failed" : `Adding ${u.name} stopped`;
  const lead = index
    ? u.docId
      ? `${u.name} was converted, but search cannot find it yet: `
      : ""
    : u.job === "convert"
      ? `${u.name} stays as it was: `
      : "";
  return (
    <div {...stylex.props(styles.failure)}>
      <Banner
        tone="danger"
        title={title}
        actions={
          <>
            <Button size="sm" variant="quiet" icon="jobs" label="Open Jobs" onClick={() => app.navigate("jobs")} />
            <Button
              size="sm"
              variant="quiet"
              iconOnly
              icon="close"
              label={dismiss}
              onClick={() => dismissUpload(u.key)}
            />
          </>
        }
      >
        {lead}
        {p.detail}
        {p.fix && (
          <span {...stylex.props(styles.fix)}>
            <strong>What to do:</strong> {p.fix}
          </span>
        )}
      </Banner>
    </div>
  );
}
