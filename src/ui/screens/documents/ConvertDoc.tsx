import { useState } from "react";
import type { DocConversion, DocJson } from "../../../core/types.ts";
import { Button } from "../../components/legacy/index.ts";
import { useApp } from "../../lib/app.ts";
import { baseName } from "../../lib/desktop.ts";
import { convertDoc } from "../../lib/uploads.ts";

// ponytail: the options a study (or the team) chose, as kept in doc.json — every conversion follows them
function optionsOf(c: DocConversion): string {
  const parts = [
    c.from && `the .${c.from} copy`,
    c.reader && (c.reader === "tagged" ? "the PDF tags" : "the page layout"),
    c.numbers?.length && `${c.numbers.length} heading number${c.numbers.length > 1 ? "s" : ""} read on the pages`,
  ].filter(Boolean);
  return parts.length ? `Converted from ${parts.join(", ")}.` : "";
}

export function ConvertDoc({
  doc,
  again,
  onClose,
  onChanged,
}: {
  doc: DocJson;
  again?: boolean;
  onClose?: () => void;
  onChanged: () => void;
}) {
  const app = useApp();
  const [figures, setFigures] = useState(app.info?.project?.rag.describeFigures !== false);
  const [study, setStudy] = useState(false);
  const options = doc.conversion ? optionsOf(doc.conversion) : "";
  const name = baseName(doc.source.name);
  const noFigures = again && doc.converted?.stats?.figures === 0;
  const go = () => {
    void convertDoc(doc.id, name, { describeFigures: figures, study }, onChanged);
    onClose?.();
  };
  return (
    <section className="card docconvert" aria-label={again ? "Convert again" : "Convert and index"}>
      <div className="docconvert-head">
        <span className="h">{again ? "Convert again" : "Not converted yet"}</span>
        <span className="muted">
          {again
            ? "Reads the copied file again and reindexes it; status, Claude context and figure descriptions are kept."
            : "Set the status and the Claude context first if you know them: Claude reads them while it converts. Converting reads the file into text with anchors and figures, then search indexes it."}
        </span>
        {options && (
          <span className="muted" title={doc.conversion?.notes}>
            {options}
          </span>
        )}
      </div>
      {!noFigures && (
        <label
          className="docconvert-opt"
          title="Claude opens each picture and writes what it shows and the text it reads in it, so search finds the figures. Costs one Claude run per 20 figures."
        >
          <input type="checkbox" checked={figures} onChange={(e) => setFigures(e.target.checked)} />
          {again ? "Claude describes the figures not described yet" : "Claude describes the figures"}
        </label>
      )}
      <label
        className="docconvert-opt"
        title="Before converting, Claude looks at the original's profile and a few of its pages and chooses the copy, the PDF reader and the heading numbers printed on the pages; after, it compares the text with the pages and may convert once more or leave a Claude action. Needs a PDF copy. Two Claude runs."
      >
        <input type="checkbox" checked={study} onChange={(e) => setStudy(e.target.checked)} />
        Claude studies the original first, then checks the result against its pages
      </label>
      <div className="docconvert-acts">
        <span className="spacer" />
        {onClose && (
          <Button tone="quiet" size="sm" onClick={onClose}>
            Cancel
          </Button>
        )}
        <Button tone="primary" onClick={go}>
          {again ? "Convert again and index" : "Convert and index"}
        </Button>
      </div>
    </section>
  );
}
