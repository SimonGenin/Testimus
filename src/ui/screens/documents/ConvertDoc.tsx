import { useState } from "react";
import type { DocJson } from "../../../core/types.ts";
import { AdditionalContext } from "../../components/claude/AdditionalContext.tsx";
import { Button } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { baseName } from "../../lib/desktop.ts";
import { convertDoc, settled, useUploads } from "../../lib/uploads.ts";

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
  const [ids, setIds] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  const running = useUploads().find((u) => u.docId === doc.id && u.job === "convert" && !settled(u));
  const contexts = ids ?? app.info?.project?.claude.contexts ?? [];
  const name = baseName(doc.source.path.replace(/^upload: /, ""));
  const go = () => {
    void convertDoc(doc.id, name, { note, contexts }, onChanged);
    onClose?.();
  };
  return (
    <section className="card docconvert" aria-label={again ? "Convert again" : "Convert and index"}>
      <div className="docconvert-head">
        <span className="h">{again ? "Convert again" : "Not converted yet"}</span>
        <span className="muted">
          {again
            ? "Reads the copied file again and reindexes it; status, amends, context and figure descriptions are kept."
            : "Set the status, amends and context first if you know them. Converting reads the file into text with anchors and figures, Claude describes the figures, then search indexes it."}
        </span>
      </div>
      <span className="label">Context for this conversion only</span>
      <AdditionalContext
        id={`doc-convert-note-${doc.id}`}
        ids={contexts}
        note={note}
        compact
        disabled={!!running}
        onIds={setIds}
        onNote={setNote}
      />
      <div className="docconvert-acts">
        {running && (
          <span className="muted" role="status">
            {running.message}
          </span>
        )}
        <span className="spacer" />
        {onClose && (
          <Button tone="quiet" size="sm" onClick={onClose}>
            Cancel
          </Button>
        )}
        <Button tone="primary" disabled={!!running} onClick={go}>
          {running ? "Converting…" : again ? "Convert again and index" : "Convert and index"}
        </Button>
      </div>
    </section>
  );
}
