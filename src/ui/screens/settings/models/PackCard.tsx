import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { Facts } from "../../../components/ui/Facts.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { type } from "../../../components/ui/type.ts";
import { border, color, space } from "../../../styles/tokens.stylex.ts";
import { useJob } from "../jobs.ts";
import type { PackRow } from "./data.ts";
import { size } from "./data.ts";
import { FitChip } from "./FitChip.tsx";
import { OpLine } from "./OpLine.tsx";
import type { Op } from "./ops.tsx";

const styles = stylex.create({
  card: { display: "flex", flexDirection: "column", minWidth: 0 },
  off: { opacity: 0.7 },
  head: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  body: { display: "flex", flexDirection: "column", gap: space.s5 },
  intent: { margin: 0, color: color.textMuted },
  variant: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingTop: space.s3,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  small: { color: color.textMuted },
  muted: { color: color.textMuted },
  fit: { display: "flex", gap: space.s2, flexWrap: "wrap" },
  skipped: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    margin: 0,
    padding: 0,
    listStyle: "none",
    color: color.textMuted,
  },
  skip: { display: "flex", gap: space.s1, alignItems: "flex-start" },
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
    <span {...stylex.props(type.compact, type.medium)}>
      {label(embedding)}
      <span {...stylex.props(type.regular, styles.muted)}>{reranker ? " + " : " · "}</span>
      {reranker ? label(reranker) : <span {...stylex.props(type.regular, styles.muted)}>no reranker</span>}
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
        fill
        selected={pack.active}
        title={
          <span {...stylex.props(styles.head)}>
            <span {...stylex.props(type.title)}>{pack.label}</span>
            {pack.active && <Badge label="In use" tone="success" icon="check" size="sm" />}
          </span>
        }
        footer={
          <div {...stylex.props(styles.foot)}>
            {op ? (
              <OpLine op={op} />
            ) : pack.active && ready ? null : (
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
          <p {...stylex.props(type.compact, styles.intent)}>{pack.intent}</p>
          {pack.available ? (
            <div {...stylex.props(styles.variant)}>
              <span {...stylex.props(type.small, styles.small)}>
                On this PC{pack.variant ? ` (its ${ORDINAL[pack.variant]} choice)` : ""}
              </span>
              {models}
              <span {...stylex.props(styles.fit)}>
                <FitChip fit={pack.fit} processorOnly={pack.processorOnly} />
              </span>
              {pack.fit?.message && <span {...stylex.props(type.small, styles.small)}>{pack.fit.message}</span>}
            </div>
          ) : (
            <Badge label="Not available on this PC" tone="danger" icon="x-circle" />
          )}
          {pack.skipped.length > 0 && (
            <ul aria-label="Skipped variants" {...stylex.props(type.small, styles.skipped)}>
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
          <Facts
            size="sm"
            items={[
              {
                label: "Download",
                value: pack.available ? (pack.downloadMB > 0 ? size(pack.downloadMB) : "Installed") : "—",
              },
              { label: "Speed", value: pack.speed ?? "Not measured on this PC yet" },
              { label: "Quality", value: pack.quality },
              !!pack.projectQuality && { label: "On this project", value: pack.projectQuality },
            ]}
          />
        </div>
      </Card>
    </article>
  );
}
