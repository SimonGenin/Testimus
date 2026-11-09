import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { DocConversion, Effort } from "../../../core/types.ts";
import { effortOptions, useModelChoice } from "../../components/claude/ModelPicker.tsx";
import { useClaudeStatus } from "../../components/claude/useClaudeStatus.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { GroupSelect } from "../../components/ui/GroupSelect.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { invalidate } from "../../lib/data/query.ts";
import { baseName } from "../../lib/desktop.ts";
import { type Described, isMedia } from "../../lib/media.ts";
import { jobToast } from "../../lib/toast.ts";
import { convertDoc, importClaude, setImportClaude } from "../../lib/uploads.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  wrap: { padding: space.s5, overflowY: "auto", flex: 1, minHeight: 0 },
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  text: { margin: 0, color: color.textMuted },
  group: { display: "flex", flexDirection: "column", gap: space.s3 },
  caption: { margin: 0, color: color.textMuted },
  run: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  acts: { display: "flex", justifyContent: "flex-end", gap: space.s3 },
});

const OFFLINE = "Claude is not connected";

// ponytail: Claude is missing or signed out — what a Claude run asks for is disabled with this reason
export function useClaudeOffline(): string | false {
  const { status } = useClaudeStatus();
  return status && (!status.installed || status.signedIn === false) ? OFFLINE : false;
}

// ponytail: the options a study (or the team) chose, as kept in doc.json — every conversion follows them
function optionsOf(c: DocConversion): string {
  const parts = [
    c.from && `the .${c.from} copy`,
    c.reader && (c.reader === "tagged" ? "the PDF tags" : "the page layout"),
    c.numbers?.length && `${c.numbers.length} heading number${c.numbers.length > 1 ? "s" : ""} read on the pages`,
    c.figures?.length && `${c.figures.length} figure${c.figures.length > 1 ? "s" : ""} drawn from the PDF pages`,
  ].filter(Boolean);
  return parts.length ? `Converted from ${parts.join(", ")}.` : "";
}

// ponytail: the model and effort Claude uses while documents are converted and indexed (figures, context headers):
// kept for every conversion and reindex until the app is closed
export function ClaudeChoice() {
  const app = useApp();
  const [run, setRun] = useState(importClaude);
  const model = run.model || app.info?.project?.claude.model || "opus";
  const effort: Effort = run.effort || "low";
  const pick = (next: { model: string; effort: Effort }) => {
    setImportClaude(next);
    setRun(next);
  };
  const choice = useModelChoice(model, (m) => pick({ model: m, effort }));
  return (
    <div {...stylex.props(styles.run)}>
      <GroupSelect
        label="Claude's model and effort"
        prefix="Claude"
        groups={[
          { label: "Model", value: choice.selected, options: choice.options, onChange: choice.pick },
          {
            label: "Effort",
            value: effort,
            options: effortOptions,
            onChange: (x) => pick({ model, effort: x as Effort }),
          },
        ]}
      />
    </div>
  );
}

function Options({
  doc,
  again,
  figures,
  study,
  offline,
  onFigures,
  onStudy,
}: {
  doc: Described;
  again: boolean;
  figures: boolean;
  study: boolean;
  offline: string | false;
  onFigures: (on: boolean) => void;
  onStudy: (on: boolean) => void;
}) {
  const noFigures = again && doc.converted?.stats?.figures === 0;
  if (isMedia(doc.type))
    return (
      <div {...stylex.props(styles.group)}>
        <h3 {...stylex.props(type.small, type.strong, styles.caption)}>While preparing</h3>
        <Checkbox
          checked={figures && !offline}
          disabled={offline}
          onChange={onFigures}
          label={again ? "Claude reads the pictures not read yet" : "Claude reads the pictures and surveys the videos"}
          hint="Claude opens each picture (20 a run) and writes what it shows and the text it reads in it; a video is first surveyed from its mosaics (chapters, moments to see). What Claude reads is searched, never quoted."
        />
        <ClaudeChoice />
      </div>
    );
  return (
    <div {...stylex.props(styles.group)}>
      <h3 {...stylex.props(type.small, type.strong, styles.caption)}>While converting</h3>
      {!noFigures && (
        <Checkbox
          checked={figures && !offline}
          disabled={offline}
          onChange={onFigures}
          label={again ? "Claude describes the figures not described yet" : "Claude describes the figures"}
          hint="Claude opens each picture and writes what it shows and the text it reads in it, so search finds the figures. One Claude run per 20 figures."
        />
      )}
      <Checkbox
        checked={study && !offline}
        disabled={offline}
        onChange={onStudy}
        label="Claude studies the original first, then checks the result against its pages"
        hint="Claude chooses the copy, the PDF reader and the heading numbers printed on the pages, then compares the text with the pages. Needs a PDF copy. Two Claude runs."
      />
      <ClaudeChoice />
    </div>
  );
}

// ponytail: converting reads the copy into text with anchors and figures, then indexes it — one job; « again » keeps
// the status, the context and the figure descriptions
export function ConvertDoc({
  doc,
  again = false,
  described,
  onClose,
}: {
  doc: Described;
  again?: boolean;
  /** figures that already have a description (they are kept) */
  described?: number;
  onClose?: () => void;
}) {
  const app = useApp();
  const client = useQueryClient();
  const [figures, setFigures] = useState(app.info?.project?.rag.describeFigures !== false);
  const [study, setStudy] = useState(false);
  const media = isMedia(doc.type);
  const offline = useClaudeOffline();
  const settled = doc.conversion ? optionsOf(doc.conversion) : "";
  const go = () => {
    void convertDoc(
      doc.id,
      baseName(doc.source.name || doc.source.file),
      {
        describeFigures: figures && !offline,
        study: study && !offline && !media,
      },
      () => {
        void invalidate(client, [["docs.list"], ["docs.show", { id: doc.id }], ["rag.status"]]);
        app.refreshInfo();
      },
      (jobId) => jobToast(`Converting ${doc.code} — started`, jobId, app.navigate),
    );
    onClose?.();
  };
  const options = (
    <Options
      doc={doc}
      again={again}
      figures={figures}
      study={study}
      offline={offline}
      onFigures={setFigures}
      onStudy={setStudy}
    />
  );
  if (again) {
    const stats = doc.converted?.stats;
    const warnings = doc.converted?.warnings.length ?? 0;
    const kept = described ?? 0;
    const consequences: [number, string][] = [
      ...(stats?.figures
        ? [
            [
              stats.figures,
              `figure${stats.figures === 1 ? "" : "s"} read again${kept ? ` — ${kept} already described ${kept === 1 ? "is" : "are"} kept` : ""}`,
            ] as [number, string],
          ]
        : []),
      ...(stats
        ? [
            [stats.sections, `section${stats.sections === 1 ? "" : "s"} reindexed in every vector space`] as [
              number,
              string,
            ],
          ]
        : []),
      [warnings, `conversion warning${warnings === 1 ? "" : "s"} recomputed`],
    ];
    return (
      <Modal
        title={`Convert ${doc.code} again?`}
        subtitle={`Reads ${baseName(doc.source.name || doc.source.file) || "the copy"} again and reindexes it. Status, Claude context and figure descriptions are kept; anchors stay the same, so tests keep their sources.`}
        consequences={consequences}
        consequencesAt="start"
        confirm={{ verb: "Convert again and index", icon: "refresh", onConfirm: go }}
        onClose={() => onClose?.()}
      >
        <div {...stylex.props(styles.body)}>
          {settled && (
            <p title={doc.conversion?.notes} {...stylex.props(type.body, styles.text)}>
              {settled}
            </p>
          )}
          {options}
        </div>
      </Modal>
    );
  }
  return (
    <div {...stylex.props(styles.wrap)}>
      <section aria-label="Convert and index">
        <Card title={media ? "Not prepared yet" : "Not converted yet"}>
          <div {...stylex.props(styles.body)}>
            <p {...stylex.props(type.body, styles.text)}>
              {media
                ? "Set the Claude context first if you know it: Claude reads it with the pictures. Preparing makes each picture (and reads a video: its length, its speech, its frames), Claude reads them, then search indexes the document."
                : "Set the status and the Claude context first if you know them: Claude reads them while it converts. Converting reads the file into text with anchors and figures, then search indexes it."}
            </p>
            {settled && (
              <p title={doc.conversion?.notes} {...stylex.props(type.body, styles.text)}>
                {settled}
              </p>
            )}
            {options}
            <div {...stylex.props(styles.acts)}>
              <Button variant="primary" label={media ? "Prepare and read" : "Convert and index"} onClick={go} />
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
