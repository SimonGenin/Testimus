import * as stylex from "@stylexjs/stylex";
import type { Finding, Source } from "../../../core/types.ts";
import { Badge, SeverityBadge } from "../../components/ui/Badge.tsx";
import { SourceChip } from "../../components/ui/SourceChip.tsx";
import { parseSourceRef, sourcePlace } from "../../lib/fields.ts";
import { border, color, fontSize, fontWeight, lineHeight, radius, shadow, space } from "../../styles/tokens.stylex.ts";
import { kindLabel, refKey } from "./sources.ts";

const styles = stylex.create({
  card: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
  },
  whole: { backgroundColor: color.surface, boxShadow: shadow.s1 },
  selected: { borderColor: color.accent, boxShadow: `0 0 0 ${border.width} ${color.accent}` },
  head: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  kind: { fontSize: fontSize.compact, lineHeight: lineHeight.compact, fontWeight: fontWeight.medium },
  grow: { flex: 1 },
  where: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textSubtle },
  message: { margin: 0, fontSize: fontSize.body, lineHeight: lineHeight.body, overflowWrap: "anywhere" },
  stale: { color: color.textMuted },
  note: { margin: 0, fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textSubtle },
  chips: { display: "flex", flexWrap: "wrap", gap: space.s2, alignItems: "center" },
});

export function FindingSources({
  finding,
  selected,
  onSelect,
}: {
  finding: Finding;
  selected: string;
  onSelect: (s: Source) => void;
}) {
  const refs = finding.sources.map(parseSourceRef).filter((s): s is Source => !!s);
  if (!refs.length) return null;
  return (
    <div {...stylex.props(styles.chips)}>
      {refs.map((s) => (
        <SourceChip
          key={refKey(s)}
          reference={`${s.docId} ${sourcePlace(s.anchor)}`}
          quote={s.quote || undefined}
          figure={s.anchor.startsWith("fig:")}
          pressed={selected === refKey(s)}
          onOpen={() => onSelect(s)}
        />
      ))}
    </div>
  );
}

// ponytail: one finding of the check, where it sits (a step or the whole test), who found it, and the passages it names
export function FindingCard({
  finding,
  stale,
  where,
  whole = false,
  selected,
  onSelect,
}: {
  finding: Finding;
  stale: boolean;
  where: string;
  whole?: boolean;
  selected: string;
  onSelect: (s: Source) => void;
}) {
  const head = `${kindLabel(finding.kind)}`;
  const by = finding.pass === "mechanical" ? "mechanical check" : finding.pass === "semantic" ? "read by Claude" : "";
  const on = finding.sources.includes(selected);
  return (
    <div
      role="note"
      aria-label={`${stale ? "Out of date · " : ""}${SEVERITY_WORD[finding.severity]} · ${head}`}
      {...stylex.props(styles.card, whole && styles.whole, on && styles.selected)}
    >
      <div {...stylex.props(styles.head)}>
        <SeverityBadge severity={finding.severity} />
        <span {...stylex.props(styles.kind)}>{head}</span>
        {stale && <Badge size="sm" icon="history" label="Out of date" tooltip="The test changed after this check" />}
        <span {...stylex.props(styles.grow)} />
        <span {...stylex.props(styles.where)}>{by ? `${where} · ${by}` : where}</span>
      </div>
      <p {...stylex.props(styles.message, stale && styles.stale)}>{finding.message}</p>
      {stale && (
        <p {...stylex.props(styles.note)}>The test changed after this check. Run the check again to confirm.</p>
      )}
      <FindingSources finding={finding} selected={selected} onSelect={onSelect} />
      {!finding.sources.length && finding.pass === "semantic" && (
        <p {...stylex.props(styles.note)}>No passage was found for it.</p>
      )}
    </div>
  );
}

const SEVERITY_WORD = { error: "Error", warning: "Warning", info: "Info" } as const;
