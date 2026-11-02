import { useState } from "react";
import type { TraceView } from "../../../core/types.ts";
import { useApp } from "../../lib/app.ts";
import { plural } from "../../lib/format.ts";
import { Button, Chip } from "../ui/index.ts";
import { CoverageDialog } from "./CoverageDialog.tsx";
import { TrackDialog } from "./TrackDialog.tsx";

export function TracesBar({ hint }: { hint: string }) {
  const app = useApp();
  const traces = app.info?.traces ?? [];
  const [open, setOpen] = useState<TraceView | "new" | null>(null);
  const [coverage, setCoverage] = useState(false);
  return (
    <fieldset className="traces-bar" aria-label="Tracked ids">
      <span className="label">Tracked ids</span>
      {traces.length === 0 && <span className="muted">{hint}</span>}
      {traces.map((t) => (
        <Chip
          key={t.id}
          small
          icon={t.column === "local" ? "warning" : "tag"}
          title={`${t.patterns.join("  |  ")}\nStep column « ${t.field} »${t.column === "local" ? " — not in Xray yet" : ""}`}
          onClick={() => setOpen(t)}
        >
          {t.label} · {plural(t.found, "id")}
        </Chip>
      ))}
      <Button tone="quiet" size="sm" icon="plus" onClick={() => setOpen("new")}>
        Track ids…
      </Button>
      {traces.length > 0 && (
        <Button tone="quiet" size="sm" icon="checked" onClick={() => setCoverage(true)}>
          Coverage
        </Button>
      )}
      {open && <TrackDialog initial={open === "new" ? undefined : open} onClose={() => setOpen(null)} />}
      {coverage && <CoverageDialog onClose={() => setCoverage(false)} />}
    </fieldset>
  );
}
