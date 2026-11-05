import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { useCommand, useRead } from "../../lib/data/query.ts";
import { type Batch, batchJob, batchLine, jobPercent } from "../../lib/media.ts";
import { useProjectJobs } from "../../lib/projectJobs.ts";
import { errorToast, jobToast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space.s3 },
  row: { display: "flex", alignItems: "flex-start", gap: space.s2 },
  grow: { flex: 1, minWidth: 0 },
  side: { display: "flex", alignItems: "center", gap: space.s1, flexShrink: 0 },
  note: { margin: 0, color: color.textMuted },
});

// ponytail: the batches of a document in its side panel — each one ticked « in the document » or not, its state, and
// the way into it; a batch a job is working on says so and waits
export function DocBatches({
  docId,
  disabled = false,
  onOpen,
  onAdd,
}: {
  docId: string;
  disabled?: boolean;
  onOpen: (lot: string) => void;
  onAdd: () => void;
}) {
  const app = useApp();
  const list = useRead("media.list", { doc: docId });
  const jobs = useProjectJobs([]);
  const include = useCommand("media.include", { invalidates: [["media.list"], ["media.show"]] });
  const batches: Batch[] = Array.isArray(list.data) ? list.data : [];
  const adding = batchJob(jobs, docId);
  const toggle = (b: Batch, on: boolean) =>
    include.mutate(
      { doc: docId, lot: b.id, included: on },
      {
        onSuccess: (r) =>
          jobToast(
            on ? `Putting « ${b.title} » in the document — started` : `Taking « ${b.title} » out — started`,
            r.jobId,
            app.navigate,
          ),
        onError: (e) => errorToast(e, "Could not change the batch"),
      },
    );
  return (
    <>
      {batches.length === 0 && !adding && (
        <p {...stylex.props(type.small, styles.note)}>
          Photos of the real system, read by Claude, become annexes of the document: they say how to do a step, never
          what is expected. Drop photos on the document, or add them here.
        </p>
      )}
      {(batches.length > 0 || adding) && (
        <ul aria-label="Photos and videos" {...stylex.props(styles.list)}>
          {batches.map((b) => {
            const job = batchJob(jobs, docId, b.id);
            const pct = jobPercent(job);
            return (
              <li key={b.id} {...stylex.props(styles.row)}>
                <span {...stylex.props(styles.grow)}>
                  <Checkbox
                    checked={b.included}
                    disabled={disabled || job ? "Wait until the batch's work is done" : false}
                    label={b.title}
                    hint={`${batchLine(b)} · ${b.included ? "in the document" : "not in the document"}`}
                    onChange={(on) => toggle(b, on)}
                  />
                </span>
                <span {...stylex.props(styles.side)}>
                  {job ? (
                    <Badge
                      size="sm"
                      tone="claude"
                      busy
                      label={pct === null ? "Working…" : `${pct} %`}
                      tooltip={job.message}
                    />
                  ) : b.state === "failed" ? (
                    <Badge
                      size="sm"
                      tone="danger"
                      icon="alert-circle"
                      label={String(b.failed)}
                      tooltip="Photos Testimus could not read"
                    />
                  ) : b.state === "unread" ? (
                    <Badge
                      size="sm"
                      icon="circle-dashed"
                      label={String(b.photos - b.analysed)}
                      tooltip="Photos Claude has not read yet"
                    />
                  ) : null}
                  <Button
                    size="sm"
                    variant="quiet"
                    iconOnly
                    icon="chevron-right"
                    label={`Open ${b.title}`}
                    onClick={() => onOpen(b.id)}
                  />
                </span>
              </li>
            );
          })}
          {adding && (
            <li {...stylex.props(styles.row)}>
              <span {...stylex.props(type.small, styles.grow, styles.note)}>{adding.message ?? "Adding a batch…"}</span>
              <Badge
                size="sm"
                tone="claude"
                busy
                label={jobPercent(adding) === null ? "Working…" : `${jobPercent(adding)} %`}
              />
            </li>
          )}
        </ul>
      )}
      <span>
        <Button size="sm" icon="image" label="Add photos & videos…" disabled={disabled} onClick={onAdd} />
      </span>
    </>
  );
}
