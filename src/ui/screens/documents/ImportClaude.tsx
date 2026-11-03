import { useState } from "react";
import type { Effort } from "../../../core/types.ts";
import { EFFORTS, ModelPicker } from "../../components/claude/ModelPicker.tsx";
import { useApp } from "../../lib/app.ts";
import { importClaude, setImportClaude } from "../../lib/uploads.ts";

export function ImportClaude() {
  const app = useApp();
  const [run, setRun] = useState(importClaude);
  const model = run.model || app.info?.project?.claude.model || "opus";
  const effort: Effort = run.effort || "low";
  const pick = (next: { model: string; effort: Effort }) => {
    setImportClaude(next);
    setRun(next);
  };
  return (
    <div
      className="docs-claude"
      title="Claude model and effort used when documents are added or indexed: figure descriptions, and context headers when they are on"
    >
      <span className="label">Claude</span>
      <ModelPicker value={model} className="btn btn-sm select" onChange={(m) => pick({ model: m, effort })} />
      <select
        className="btn btn-sm select"
        aria-label="Effort"
        value={effort}
        onChange={(e) => pick({ model, effort: e.target.value as Effort })}
      >
        {EFFORTS.map((x) => (
          <option key={x} value={x}>
            Effort: {x}
          </option>
        ))}
      </select>
    </div>
  );
}
