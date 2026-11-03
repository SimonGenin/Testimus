import type { DocJson } from "../../../core/types.ts";
import { Button } from "../../components/ui/index.ts";
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
  const name = baseName(doc.source.path.replace(/^upload: /, ""));
  const go = () => {
    void convertDoc(doc.id, name, {}, onChanged);
    onClose?.();
  };
  return (
    <section className="card docconvert" aria-label={again ? "Convert again" : "Convert and index"}>
      <div className="docconvert-head">
        <span className="h">{again ? "Convert again" : "Not converted yet"}</span>
        <span className="muted">
          {again
            ? "Reads the copied file again and reindexes it; status, Claude context and figure descriptions are kept."
            : "Set the status and the Claude context first if you know them: Claude reads them while it converts. Converting reads the file into text with anchors and figures, Claude describes the figures, then search indexes it."}
        </span>
      </div>
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
