import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { border, color, fontSize, fontWeight, lineHeight, space } from "../../../styles/tokens.stylex.ts";
import { useJob } from "../jobs.ts";
import { Hint } from "../Section.tsx";
import type { PackRow } from "./data.ts";
import { size } from "./data.ts";
import { FitChip } from "./FitChip.tsx";
import { OpLine } from "./OpLine.tsx";
import type { Op } from "./ops.tsx";

const styles = stylex.create({
  card: { display: "flex", flexDirection: "column", minWidth: 0 },
  off: { opacity: 0.7 },
  head: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  body: { display: "flex", flexDirection: "column", gap: space.s3 },
  variant: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingTop: space.s3,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  small: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
  models: { fontSize: fontSize.compact, lineHeight: lineHeight.compact, fontWeight: fontWeight.medium },
  muted: { color: color.textMuted, fontWeight: fontWeight.regular },
  fit: { display: "flex", gap: space.s2, flexWrap: "wrap" },
  skipped: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: 0,
    listStyle: "none",
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
  },
  skip: { display: "flex", gap: space.s1, alignItems: "flex-start" },
  facts: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: space.s4,
    rowGap: space.s1,
    margin: 0,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
  },
  dt: { color: color.textMuted },
  dd: { margin: 0 },
  foot: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap", width: "100%" },
});

const ORDINAL = ["first", "second", "third", "fourth", "fifth"];

export function Models({
  embedding,
  reranker,
  label,
}: {
  embedding: string;
  reranker: string | null;
  label: (id: string) => string;
}) {
  return (
    <span {...stylex.props(styles.models)}>
      {label(embedding)}
      <span {...stylex.props(styles.muted)}>{reranker ? " + " : " · "}</span>
      {reranker ? label(reranker) : <span {...stylex.props(styles.muted)}>no reranker</span>}
    </span>
  );
}

// ponytail: Measure, Measure again, or the measure's progress while it runs (a click opens it)
function MeasureButton({
  jobId,
  again,
  disabled,
  onClick,
}: {
  jobId: string | null;
  again: boolean;
  disabled: boolean | string;
  onClick: () => void;
}) {
  const { live } = useJob(jobId);
  let label = again ? "Measure again" : "Measure";
  if (jobId !== null) label = live.pct !== null ? `Measuring · ${live.pct} %` : "Measuring…";
  return <Button size="sm" variant="quiet" icon="target" label={label} disabled={disabled} onClick={onClick} />;
}

export function PackCard({
  pack,
  label,
  op,
  measure,
  busy,
  onUse,
  onMeasure,
}: {
  pack: PackRow;
  label: (id: string) => string;
  op: Op | null;
  measure?: Op | null;
  busy: boolean;
  onUse: () => void;
  onMeasure?: () => void;
}) {
  const ready = pack.available && pack.downloadMB === 0;
  const measuring = !!measure;
  let models: ReactNode = null;
  if (pack.embedding) models = <Models embedding={pack.embedding} reranker={pack.reranker} label={label} />;
  return (
    <article aria-label={`${pack.label} pack`} {...stylex.props(styles.card, !pack.available && styles.off)}>
      <Card
        selected={pack.active}
        title={
          <span {...stylex.props(styles.head)}>
            {pack.label}
            {pack.active && <Badge label="In use" tone="success" icon="check" size="sm" />}
          </span>
        }
        footer={
          <div {...stylex.props(styles.foot)}>
            {op ? (
              <OpLine op={op} />
            ) : pack.active && ready ? (
              <Button size="sm" icon="check" label="Using this pack" disabled={`The ${pack.label} pack is in use`} />
            ) : (
              <Button size="sm" label="Use this pack" disabled={!pack.available || busy} onClick={onUse} />
            )}
            {!op && onMeasure && (
              <MeasureButton
                jobId={measure?.jobId ?? null}
                again={pack.measuredHere}
                disabled={!ready ? "Install the pack's models first (Use this pack)" : busy && !measuring}
                onClick={onMeasure}
              />
            )}
          </div>
        }
      >
        <div {...stylex.props(styles.body)}>
          <Hint>{pack.intent}</Hint>
          {pack.available ? (
            <div {...stylex.props(styles.variant)}>
              <span {...stylex.props(styles.small)}>
                On this PC{pack.variant ? ` (its ${ORDINAL[pack.variant]} choice)` : ""}
              </span>
              {models}
              <span {...stylex.props(styles.fit)}>
                <FitChip fit={pack.fit} processorOnly={pack.processorOnly} />
              </span>
              {pack.fit?.message && <span {...stylex.props(styles.small)}>{pack.fit.message}</span>}
            </div>
          ) : (
            <Badge label="Not available on this PC" tone="danger" icon="x-circle" />
          )}
          {pack.skipped.length > 0 && (
            <ul aria-label="Skipped variants" {...stylex.props(styles.skipped)}>
              {pack.skipped.map((s) => (
                <li key={s} {...stylex.props(styles.skip)}>
                  <Icon name="chevron-right" size="sm" />
                  <span>
                    {pack.available ? "Skipped: " : ""}
                    {s}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <dl {...stylex.props(styles.facts)}>
            <dt {...stylex.props(styles.dt)}>Download</dt>
            <dd {...stylex.props(styles.dd)}>
              {pack.available ? (pack.downloadMB > 0 ? size(pack.downloadMB) : "Installed") : "—"}
            </dd>
            <dt {...stylex.props(styles.dt)}>Speed</dt>
            <dd {...stylex.props(styles.dd)}>{pack.speed ?? "Not measured on this PC yet"}</dd>
            <dt {...stylex.props(styles.dt)}>Quality</dt>
            <dd {...stylex.props(styles.dd)}>{pack.quality}</dd>
            {pack.projectQuality && (
              <>
                <dt {...stylex.props(styles.dt)}>On this project</dt>
                <dd {...stylex.props(styles.dd)}>{pack.projectQuality}</dd>
              </>
            )}
          </dl>
        </div>
      </Card>
    </article>
  );
}
