import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { DocJson } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { useCommand, useRead } from "../../lib/data/query.ts";
import { message, plural } from "../../lib/format.ts";
import { testRef } from "../../lib/labels.ts";
import { type BatchShown, batchJob, batchLine, isPhoto, jobPercent } from "../../lib/media.ts";
import { useProjectJobs } from "../../lib/projectJobs.ts";
import { errorToast, jobToast } from "../../lib/toast.ts";
import { importClaude } from "../../lib/uploads.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { BatchFiles, filesInput, type PickedFile } from "./BatchFiles.tsx";
import { useClaudeOffline } from "./ConvertDoc.tsx";
import { FigureImage } from "./FigureDetail.tsx";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s5 },
  fields: { display: "flex", flexDirection: "column", gap: space.s4 },
  row: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  grow: { flex: 1 },
  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${size.tooltipMax}), 1fr))`,
    gap: space.s4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  photo: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  head: { display: "flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  name: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  muted: { margin: 0, color: color.textMuted },
  text: { margin: 0, color: color.text },
  error: { margin: 0, color: color.danger },
});

type Item = BatchShown["items"][number];

const when = (iso?: string) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}` : "";

function StateBadge({ item }: { item: Item }) {
  if (item.state === "analysed") return <Badge size="sm" tone="claude" icon="claude" label="Read" />;
  if (item.state === "failed") return <Badge size="sm" tone="danger" icon="alert-circle" label="Unreadable" />;
  return <Badge size="sm" icon="circle-dashed" label="Not read yet" />;
}

function Photo({
  docId,
  item,
  busy,
  onRemove,
  onOpen,
}: {
  docId: string;
  item: Item;
  busy: boolean;
  onRemove: () => void;
  onOpen?: () => void;
}) {
  return (
    <li>
      <Card density="compact" fill>
        <div {...stylex.props(styles.photo)}>
          <FigureImage
            docId={docId}
            figure={{ file: item.figure ?? "", anchor: item.figureAnchor, caption: item.name, description: "" }}
          />
          <div {...stylex.props(styles.head)}>
            <span title={item.name} {...stylex.props(type.compact, type.strong, styles.name)}>
              {item.name}
            </span>
            <StateBadge item={item} />
          </div>
          {item.takenAt && <p {...stylex.props(type.small, styles.muted)}>Taken {when(item.takenAt)}</p>}
          {item.error && <p {...stylex.props(type.small, styles.error)}>{item.error}</p>}
          {item.description && <p {...stylex.props(type.compact, styles.text)}>{item.description}</p>}
          {item.labels.length > 0 && (
            <p {...stylex.props(type.small, styles.muted)}>Visible text: {item.labels.join(" · ")}</p>
          )}
          {item.illustrates.length > 0 && (
            <p {...stylex.props(type.small, styles.muted)}>Illustrates {item.illustrates.join(", ")}</p>
          )}
          <div {...stylex.props(styles.row)}>
            {onOpen && <Button size="sm" variant="quiet" icon="eye" label="In the annex" onClick={onOpen} />}
            <span {...stylex.props(styles.grow)} />
            <Button size="sm" variant="quiet" icon="trash" label="Remove" disabled={busy} onClick={onRemove} />
          </div>
        </div>
      </Card>
    </li>
  );
}

// ponytail: one batch — what the team says about it (title, context, reference), whether it is in the document, each
// photo with what Claude read in it; adding, removing or reading again are jobs, the batch shows the one running
export function BatchDetail({
  doc,
  lot,
  onClose,
  onOpenAnchor,
}: {
  doc: Pick<DocJson, "id" | "code" | "title">;
  lot: string;
  onClose: () => void;
  onOpenAnchor?: (anchor: string) => void;
}) {
  const app = useApp();
  const shown = useRead("media.show", { doc: doc.id, lot });
  const jobs = useProjectJobs([]);
  const running = batchJob(jobs, doc.id, lot);
  const offline = useClaudeOffline();
  const context = useCommand("media.context", { invalidates: [["media.list"], ["media.show"]] });
  const include = useCommand("media.include", { invalidates: [["media.list"], ["media.show"]] });
  const addFiles = useCommand("media.addFiles", { invalidates: [["media.list"], ["media.show"]] });
  const removeFile = useCommand("media.removeFile", { invalidates: [["media.list"], ["media.show"]] });
  const analyse = useCommand("media.analyse", { invalidates: [["media.list"], ["media.show"]] });
  const remove = useCommand("media.remove", { invalidates: [["media.list"]] });
  const [edit, setEdit] = useState<{ title: string; context: string; reference: boolean } | null>(null);
  const [more, setMore] = useState<PickedFile[]>([]);
  const [asking, setAsking] = useState(false);
  const b = shown.data;
  const busy = !!running;
  const started = (what: string) => (r: { jobId: string }) => jobToast(`${what} — started`, r.jobId, app.navigate);
  const failed = (title: string) => (e: unknown) => errorToast(e, title);
  const claude = () => {
    const { model, effort } = importClaude();
    return { ...(model ? { model } : {}), ...(effort ? { effort } : {}) };
  };

  if (!b)
    return (
      <Modal title="Batch" onClose={onClose}>
        {shown.isError ? (
          <Banner tone="danger">{message(shown.error)}</Banner>
        ) : (
          <>
            <Skeleton lines={4} />
            <Loading read="media.show" />
          </>
        )}
      </Modal>
    );

  const now = edit ?? { title: b.title, context: b.context, reference: b.reference };
  const changed =
    !!edit && (edit.title.trim() !== b.title || edit.context.trim() !== b.context || edit.reference !== b.reference);
  const unread = b.items.filter((i) => i.state !== "analysed").length;
  const save = () =>
    context.mutate(
      { doc: doc.id, lot, text: now.context, title: now.title.trim() || b.title, reference: now.reference },
      {
        onSuccess: (r) => {
          setEdit(null);
          started(`Saving « ${b.title} »`)(r);
        },
        onError: failed("Could not save the batch"),
      },
    );
  const sendMore = async () => {
    try {
      const files = await filesInput(more);
      const r = await addFiles.mutateAsync({ doc: doc.id, lot, files, ...claude() });
      setMore([]);
      started(`Adding ${plural(more.filter((f) => isPhoto(f.name)).length, "photo")} to « ${b.title} »`)(r);
    } catch (e) {
      failed("Could not add the photos")(e);
    }
  };

  if (asking)
    return (
      <Modal
        size="sm"
        title={`Remove « ${b.title} »?`}
        subtitle="Its copies, its pictures and its annex go. The tests that cite the annex keep their sources and are checked again, so they report it missing."
        consequences={[
          [b.photos, b.photos === 1 ? "photo removed" : "photos removed"],
          ...(b.citedBy.length
            ? [[b.citedBy.length, b.citedBy.length === 1 ? "test cites it" : "tests cite it"] as [number, string]]
            : []),
        ]}
        confirm={{
          verb: "Remove the batch",
          danger: true,
          onConfirm: () =>
            remove.mutate(
              { doc: doc.id, lot },
              {
                onSuccess: (r) => {
                  started(`Removing « ${b.title} »`)(r);
                  onClose();
                },
                onError: failed("Could not remove the batch"),
              },
            ),
        }}
        onClose={() => setAsking(false)}
      />
    );

  return (
    <Modal
      size="lg"
      title={b.title}
      subtitle={`${doc.code} · ${batchLine(b)} · ${b.included ? "in the document, as an annex" : "kept beside the document"}`}
      onClose={onClose}
      footNote={<span {...stylex.props(type.mono)}>{b.anchor}</span>}
      actions={
        <>
          <Button
            variant="quiet"
            icon="trash"
            label="Remove the batch"
            disabled={busy}
            onClick={() => setAsking(true)}
          />
          {b.included && onOpenAnchor && (
            <Button
              icon="eye"
              label="Read the annex"
              onClick={() => {
                onOpenAnchor(b.anchor);
                onClose();
              }}
            />
          )}
          <Button
            variant="claude"
            icon="claude"
            label={unread ? `Read ${plural(unread, "photo")}` : "Read again"}
            disabled={busy || offline || !b.items.length}
            onClick={() =>
              analyse.mutate(
                { doc: doc.id, lot, force: !unread, ...claude() },
                { onSuccess: started(`Claude reads « ${b.title} »`), onError: failed("Could not start the reading") },
              )
            }
          />
          <Button variant="primary" label="Close" onClick={onClose} />
        </>
      }
    >
      <div {...stylex.props(styles.body)}>
        {running && (
          <Progress
            tone="claude"
            label={running.message ?? "Working on the batch"}
            value={jobPercent(running)}
            detail={running.message}
          />
        )}
        <div {...stylex.props(styles.fields)}>
          <Checkbox
            checked={b.included}
            disabled={busy}
            label="In the document"
            hint="The batch is an annex at the end of the document: search, generation and the check read it."
            onChange={(on) =>
              include.mutate(
                { doc: doc.id, lot, included: on },
                {
                  onSuccess: started(on ? `Putting « ${b.title} » in the document` : `Taking « ${b.title} » out`),
                  onError: failed("Could not change the batch"),
                },
              )
            }
          />
          <Text label="Title" value={now.title} disabled={busy} onChange={(t) => setEdit({ ...now, title: t })} />
          <Text
            label="Context"
            multiline
            value={now.context}
            disabled={busy}
            placeholder="Photos du TCO réel en recette, version 3.2"
            hint="Claude reads it with the photos; the annex shows it"
            onChange={(t) => setEdit({ ...now, context: t })}
          />
          <Checkbox
            checked={now.reference}
            disabled={busy}
            label="These photos show the reference behaviour"
            hint="Only when the team says so: an expected result cited from them alone is then not flagged « observed only »."
            onChange={(on) => setEdit({ ...now, reference: on })}
          />
          {changed && (
            <div {...stylex.props(styles.row)}>
              <Button
                variant="primary"
                size="sm"
                label="Save and write the annex again"
                loading={context.isPending}
                onClick={save}
              />
              <Button size="sm" variant="quiet" label="Undo" onClick={() => setEdit(null)} />
            </div>
          )}
        </div>
        {b.citedBy.length > 0 && (
          <p {...stylex.props(type.small, styles.muted)}>Cited by {b.citedBy.map(testRef).join(", ")}.</p>
        )}
        <ul aria-label="Photos of the batch" {...stylex.props(styles.grid)}>
          {b.items.map((i) => (
            <Photo
              key={i.id}
              docId={doc.id}
              item={i}
              busy={busy}
              onOpen={
                b.included && onOpenAnchor
                  ? () => {
                      onOpenAnchor(i.anchor);
                      onClose();
                    }
                  : undefined
              }
              onRemove={() =>
                removeFile.mutate(
                  { doc: doc.id, lot, item: i.id },
                  { onSuccess: started(`Removing ${i.name}`), onError: failed("Could not remove the photo") },
                )
              }
            />
          ))}
        </ul>
        <BatchFiles files={more} onChange={setMore} disabled={busy} />
        {more.some((f) => isPhoto(f.name)) && (
          <div {...stylex.props(styles.row)}>
            <Button
              variant="primary"
              size="sm"
              icon="plus"
              label={`Add ${plural(more.filter((f) => isPhoto(f.name)).length, "photo")} to the batch`}
              loading={addFiles.isPending}
              onClick={() => void sendMore()}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
