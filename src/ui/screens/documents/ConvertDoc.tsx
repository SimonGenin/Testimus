import { useState } from "react";
import type { DocJson } from "../../../core/types.ts";
import { Button } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { baseName } from "../../lib/desktop.ts";
import { convertDoc } from "../../lib/uploads.ts";

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
  const name = baseName(doc.source.path.replace(/^upload: /, ""));
  const noFigures = again && doc.stats?.figures === 0;
  const go = () => {
    void convertDoc(doc.id, name, { describeFigures: figures }, onChanged);
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
