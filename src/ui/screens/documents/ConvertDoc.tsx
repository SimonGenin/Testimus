import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { DocConversion, DocJson, Effort } from "../../../core/types.ts";
import { EFFORTS, ModelPicker } from "../../components/claude/ModelPicker.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { useApp } from "../../lib/app.ts";
import { invalidate } from "../../lib/data/query.ts";
import { baseName } from "../../lib/desktop.ts";
import { convertDoc, importClaude, setImportClaude } from "../../lib/uploads.ts";
import { color, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  wrap: { padding: space.s5, overflowY: "auto", flex: 1, minHeight: 0 },
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  text: { margin: 0, fontSize: fontSize.body, lineHeight: lineHeight.body, color: color.textMuted },
  group: { display: "flex", flexDirection: "column", gap: space.s3 },
  caption: {
    margin: 0,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.semibold,
    color: color.textMuted,
  },
  run: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  acts: { display: "flex", justifyContent: "flex-end", gap: space.s3 },
});

// ponytail: the options a study (or the team) chose, as kept in doc.json — every conversion follows them
function optionsOf(c: DocConversion): string {
  const parts = [
    c.from && `the .${c.from} copy`,
    c.reader && (c.reader === "tagged" ? "the PDF tags" : "the page layout"),
    c.numbers?.length && `${c.numbers.length} heading number${c.numbers.length > 1 ? "s" : ""} read on the pages`,
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
  return (
    <div {...stylex.props(styles.run)}>
      <ModelPicker value={model} className="" onChange={(m) => pick({ model: m, effort })} />
      <Select
        label="Effort"
        size="sm"
        prefix="Effort"
        value={effort}
        options={EFFORTS.map((x) => ({ value: x, label: x }))}
        onChange={(x) => pick({ model, effort: x })}
      />
    </div>
  );
}

function Options({
  doc,
  again,
  figures,
  study,
  onFigures,
  onStudy,
}: {
  doc: DocJson;
  again: boolean;
  figures: boolean;
  study: boolean;
  onFigures: (on: boolean) => void;
  onStudy: (on: boolean) => void;
}) {
  const noFigures = again && doc.converted?.stats?.figures === 0;
  return (
    <div {...stylex.props(styles.group)}>
      <h3 {...stylex.props(styles.caption)}>While converting</h3>
      {!noFigures && (
        <Checkbox
          checked={figures}
          onChange={onFigures}
          label={again ? "Claude describes the figures not described yet" : "Claude describes the figures"}
          hint="Claude opens each picture and writes what it shows and the text it reads in it, so search finds the figures. One Claude run per 20 figures."
        />
      )}
      <Checkbox
        checked={study}
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
export function ConvertDoc({ doc, again = false, onClose }: { doc: DocJson; again?: boolean; onClose?: () => void }) {
  const app = useApp();
  const client = useQueryClient();
  const [figures, setFigures] = useState(app.info?.project?.rag.describeFigures !== false);
  const [study, setStudy] = useState(false);
  const kept = doc.conversion ? optionsOf(doc.conversion) : "";
  const go = () => {
    void convertDoc(doc.id, baseName(doc.source.name), { describeFigures: figures, study }, () => {
      void invalidate(client, [["docs.list"], ["docs.show", { id: doc.id }], ["rag.status"]]);
      app.refreshInfo();
    });
    onClose?.();
  };
  const options = (
    <Options doc={doc} again={again} figures={figures} study={study} onFigures={setFigures} onStudy={setStudy} />
  );
  if (again)
    return (
      <Modal
        title="Convert again"
        icon="refresh"
        subtitle={kept ? <span title={doc.conversion?.notes}>{kept}</span> : undefined}
        onClose={() => onClose?.()}
        actions={
          <>
            <Button label="Cancel" onClick={() => onClose?.()} />
            <Button variant="primary" label="Convert again and index" onClick={go} />
          </>
        }
      >
        <div {...stylex.props(styles.body)}>
          <p {...stylex.props(styles.text)}>
            Reads the copied file again and reindexes it; status, Claude context and figure descriptions are kept. The
            tests that cite it are checked again.
          </p>
          {options}
        </div>
      </Modal>
    );
  return (
    <div {...stylex.props(styles.wrap)}>
      <section aria-label="Convert and index">
        <Card title="Not converted yet">
          <div {...stylex.props(styles.body)}>
            <p {...stylex.props(styles.text)}>
              Set the status and the Claude context first if you know them: Claude reads them while it converts.
              Converting reads the file into text with anchors and figures, then search indexes it.
            </p>
            {kept && (
              <p title={doc.conversion?.notes} {...stylex.props(styles.text)}>
                {kept}
              </p>
            )}
            {options}
            <div {...stylex.props(styles.acts)}>
              <Button variant="primary" label="Convert and index" onClick={go} />
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
