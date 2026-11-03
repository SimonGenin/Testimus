import type { ReactNode } from "react";
import { Badge, Button, Icon } from "../../../components/ui/index.ts";
import { cx } from "../../../lib/format.ts";
import type { Bench } from "./BenchDialog.tsx";
import type { Op, PackRow } from "./data.ts";
import { size } from "./data.ts";
import { FitChip } from "./FitChip.tsx";
import { OpLine } from "./OpLine.tsx";

const ORDINAL = ["first", "second", "third", "fourth", "fifth"];

export function PackCard({
  pack,
  label,
  op,
  busy,
  onUse,
  onCancel,
  bench,
  onMeasure,
}: {
  pack: PackRow;
  label: (id: string) => string;
  op: Op | null;
  busy: boolean;
  onUse: () => void;
  onCancel: (jobId: string) => void;
  bench?: Bench;
  onMeasure?: () => void;
}) {
  const models: ReactNode = pack.embedding ? (
    <>
      {label(pack.embedding)}
      <span className="muted"> + </span>
      {pack.reranker ? label(pack.reranker) : <span className="muted">no reranker</span>}
    </>
  ) : null;
  const measuring = bench?.status === "running";
  const ready = pack.available && pack.downloadMB === 0;
  return (
    <article
      className={cx("card pack", pack.active && "pack-on", !pack.available && "pack-off")}
      aria-label={`${pack.label} pack`}
    >
      <div className="pack-head">
        <h3 className="h pack-title">{pack.label}</h3>
        {pack.active && (
          <Badge tone="ok" icon="check" small>
            In use
          </Badge>
        )}
      </div>
      <p className="muted pack-intent">{pack.intent}</p>
      {pack.available ? (
        <div className="pack-variant">
          <span className="label">On this PC{pack.variant ? ` (its ${ORDINAL[pack.variant]} choice)` : ""}</span>
          <span className="pack-models">{models}</span>
          <span className="pack-fit">
            <FitChip fit={pack.fit} />
            <span className="muted pack-fitmsg">{pack.fit?.message}</span>
          </span>
        </div>
      ) : (
        <div className="pack-variant">
          <span className="sev s-err">
            <Icon name="error" />
            Not available on this PC
          </span>
        </div>
      )}
      {pack.skipped.length > 0 && (
        <ul className="pack-skipped" aria-label="Skipped variants">
          {pack.skipped.map((s) => (
            <li key={s}>
              <Icon name="right" size={12} />
              <span>
                {pack.available ? "Skipped: " : ""}
                {s}
              </span>
            </li>
          ))}
        </ul>
      )}
      <dl className="pack-facts">
        <dt>Download</dt>
        <dd>{pack.available ? (pack.downloadMB > 0 ? size(pack.downloadMB) : "Nothing left") : "—"}</dd>
        <dt>Speed</dt>
        <dd>{pack.speed ?? "Not measured on this PC yet"}</dd>
        <dt>Quality</dt>
        <dd>{pack.quality}</dd>
      </dl>
      <div className="pack-foot">
        {op ? (
          <OpLine op={op} onCancel={onCancel} />
        ) : (
          <Button
            size="sm"
            disabled={!pack.available || busy}
            aria-label={`Use the ${pack.label} pack`}
            onClick={onUse}
          >
            Use this pack
          </Button>
        )}
        {!op && onMeasure && (
          <Button
            size="sm"
            tone="quiet"
            disabled={!ready || (busy && !measuring)}
            title={ready ? undefined : "Install the pack's models first (Use this pack)"}
            aria-label={measuring ? `Measuring the ${pack.label} pack` : `Measure the ${pack.label} pack`}
            onClick={onMeasure}
          >
            {measuring
              ? `Measuring${bench.pct !== null ? ` · ${bench.pct} %` : "…"}`
              : /^evidence recall/.test(pack.quality)
                ? "Measure again"
                : "Measure"}
          </Button>
        )}
      </div>
    </article>
  );
}
