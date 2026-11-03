import { useState } from "react";
import type { FigureEntry } from "../../../core/types.ts";
import { fileUrl } from "../../api.ts";
import { Segmented } from "../../components/ui/index.ts";

type Which = "all" | "described" | "bare";

export function DocFigures({
  docId,
  figures,
  onOpen,
}: {
  docId: string;
  figures: FigureEntry[];
  onOpen: (anchor: string) => void;
}) {
  const [which, setWhich] = useState<Which>("all");
  const described = figures.filter((f) => f.description.trim());
  const shown =
    which === "all" ? figures : which === "described" ? described : figures.filter((f) => !f.description.trim());
  return (
    <div className="docfigs">
      <div className="docfigs-bar">
        <Segmented
          label="Which figures"
          value={which}
          onChange={setWhich}
          options={[
            { value: "all", label: "All", count: figures.length },
            { value: "described", label: "Described", count: described.length },
            { value: "bare", label: "Not described", count: figures.length - described.length },
          ]}
        />
        <span className="muted">In reading order · open one to see it in the text</span>
      </div>
      <ul className="docfigs-grid">
        {shown.map((f) => (
          <li key={f.anchor}>
            <button
              type="button"
              className="docfig"
              title={f.description || f.caption || f.anchor}
              onClick={() => onOpen(f.anchor)}
            >
              <span className="docfig-img">
                {f.file && <img src={fileUrl(`docs/${docId}/${f.file}`)} alt="" loading="lazy" />}
              </span>
              <span className="docfig-cap">{f.caption || f.anchor}</span>
              {f.caption && <span className="mono muted docfig-id">{f.anchor}</span>}
            </button>
          </li>
        ))}
      </ul>
      {!shown.length && <p className="muted">No figure here.</p>}
    </div>
  );
}
