import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { DocJson } from "../../../core/types.ts";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useApp } from "../../lib/app.ts";
import { useCommand } from "../../lib/data/query.ts";
import { message } from "../../lib/format.ts";
import { isPhoto } from "../../lib/media.ts";
import { jobToast } from "../../lib/toast.ts";
import { importClaude } from "../../lib/uploads.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { BatchFiles, filesInput, type PickedFile } from "./BatchFiles.tsx";
import { ClaudeChoice, useClaudeOffline } from "./ConvertDoc.tsx";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s5 },
  checks: { display: "flex", flexDirection: "column", gap: space.s3 },
});

// ponytail: a new batch for a document — its photos, a title, what the team says about them; Claude reads them with
// that context (one run per 20 photos) and the batch becomes an annex of the document, unless left beside it
export function NewBatch({
  doc,
  files: dropped = [],
  onClose,
}: {
  doc: Pick<DocJson, "id" | "code" | "title">;
  files?: PickedFile[];
  onClose: () => void;
}) {
  const app = useApp();
  const add = useCommand("media.add", { invalidates: [["media.list"]] });
  const offline = useClaudeOffline();
  const [files, setFiles] = useState<PickedFile[]>(dropped);
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [include, setInclude] = useState(true);
  const [reference, setReference] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const photos = files.filter((f) => isPhoto(f.name)).length;
  const busy = reading || add.isPending;
  const go = async () => {
    if (!photos) return;
    setError(null);
    setReading(true);
    try {
      const input = await filesInput(files);
      setReading(false);
      const { model, effort } = importClaude();
      const r = await add.mutateAsync({
        doc: doc.id,
        files: input,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(context.trim() ? { context: context.trim() } : {}),
        include,
        ...(reference ? { reference } : {}),
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
      });
      jobToast(
        `Adding ${photos === 1 ? "a photo" : `${photos} photos`} to ${doc.code} — started`,
        r.jobId,
        app.navigate,
      );
      onClose();
    } catch (e) {
      setReading(false);
      setError(message(e));
    }
  };
  return (
    <Modal
      title="Add photos & videos"
      subtitle={`To ${doc.code} · ${doc.title}. Claude reads each photo with the context you give; the batch becomes an annex at the end of the document, searched and cited like the rest of it.`}
      onClose={onClose}
      busy={busy}
      error={error}
      onSubmit={() => void go()}
      actions={
        <>
          <Button label="Cancel" onClick={onClose} disabled={busy} />
          <Button
            variant="primary"
            type="submit"
            icon="plus"
            label={photos > 1 ? `Add the ${photos} photos` : "Add the batch"}
            loading={busy}
            disabled={photos ? false : "Choose at least one photo"}
          />
        </>
      }
    >
      <div {...stylex.props(styles.body)}>
        <Field label="Photos">
          <BatchFiles files={files} onChange={setFiles} disabled={busy} />
        </Field>
        <Text
          label="Title"
          value={title}
          onChange={setTitle}
          placeholder="Recette TCO 12/10"
          hint="The annex's heading; empty: « Photos » and today's date"
          disabled={busy}
        />
        <Text
          label="Context"
          multiline
          value={context}
          onChange={setContext}
          placeholder="Photos du TCO réel en recette, version 3.2"
          hint="Where and when they were taken, which version: Claude reads it with the photos, and the annex shows it"
          disabled={busy}
        />
        <div {...stylex.props(styles.checks)}>
          <Checkbox
            checked={include}
            onChange={setInclude}
            disabled={busy}
            label="In the document"
            hint="The batch is an annex of the document: search, generation and the check read it. Unticked, it is kept beside."
          />
          <Checkbox
            checked={reference}
            onChange={setReference}
            disabled={busy}
            label="These photos show the reference behaviour"
            hint="Only when the team says so: an expected result cited from them alone is then not flagged « observed only »."
          />
        </div>
        {offline ? (
          <Banner tone="info" compact>
            {offline}: the photos are added with their pictures, and Claude reads them later (Read again).
          </Banner>
        ) : (
          <ClaudeChoice />
        )}
      </div>
    </Modal>
  );
}
