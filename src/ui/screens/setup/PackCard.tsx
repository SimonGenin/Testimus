import * as stylex from "@stylexjs/stylex";
import type { FitVerdict } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { color, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { FIT, type PackRow, size } from "../settings/models/data.ts";
import { PROCESSOR_ONLY } from "../settings/models/FitChip.tsx";

const styles = stylex.create({
  title: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  badges: { display: "inline-flex", flexWrap: "wrap", gap: space.s2 },
  body: { display: "flex", flexDirection: "column", gap: space.s1 },
  intent: { color: color.textMuted, fontSize: fontSize.compact, lineHeight: lineHeight.compact },
  models: { color: color.text, fontSize: fontSize.small, lineHeight: lineHeight.small },
  warn: { color: color.warning, fontSize: fontSize.small, lineHeight: lineHeight.small },
});

const UNTESTED = "Never run on this system yet: Testimus tries it after the download and refuses it if it fails.";

function fitBadge(verdict: FitVerdict, message: string) {
  const f = FIT[verdict];
  return <Badge label={f.word} tone={f.tone} icon={f.icon} size="sm" tooltip={message} />;
}

export function PackCard({
  pack: p,
  chosen,
  suggested,
  analysed,
  label,
  onChoose,
}: {
  pack: PackRow;
  chosen: boolean;
  suggested: boolean;
  analysed: boolean;
  label: (id: string) => string;
  onChoose: (id: string) => void;
}) {
  const models =
    p.available && p.embedding
      ? `${label(p.embedding)}${p.reranker ? ` + ${label(p.reranker)}` : ""} · ${
          p.downloadMB ? `${size(p.downloadMB)} to download` : "nothing to download"
        }`
      : p.fit?.verdict === "unsupported"
        ? p.fit.message
        : `Not available on this PC${p.skipped[0] ? `: ${p.skipped[0]}` : ""}`;
  const warn =
    analysed && p.available && (p.processorOnly || p.fit?.verdict === "untested")
      ? [p.processorOnly && PROCESSOR_ONLY, p.fit?.verdict === "untested" && UNTESTED].filter(Boolean).join(" ")
      : "";
  return (
    <Card
      radio={{ name: "pack", value: p.id, checked: chosen, onSelect: onChoose, disabled: !p.available }}
      title={
        <span {...stylex.props(styles.title)}>
          {p.label} {p.active && <Badge label="In use" tone="success" icon="check" size="sm" />}
          {suggested && <Badge label="Suggested for this PC" tone="accent" icon="target" outline size="sm" />}
        </span>
      }
      actions={
        analysed && p.fit ? (
          <span {...stylex.props(styles.badges)}>
            {p.processorOnly && <Badge label="Processor only" tone="warning" icon="cpu" size="sm" />}
            {fitBadge(p.fit.verdict, p.fit.message)}
          </span>
        ) : undefined
      }
    >
      <span {...stylex.props(styles.body)}>
        <span {...stylex.props(styles.intent)}>{p.intent}</span>
        <span {...stylex.props(styles.models)}>{models}</span>
        {warn && <span {...stylex.props(styles.warn)}>{warn}</span>}
      </span>
    </Card>
  );
}
