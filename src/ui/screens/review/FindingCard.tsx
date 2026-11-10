import * as stylex from "@stylexjs/stylex";
import type { Finding, Source } from "../../../core/types.ts";
import { videoPreview } from "../../components/sources/VideoPreview.tsx";
import { Badge, SeverityBadge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { SourceChip } from "../../components/ui/SourceChip.tsx";
import { type } from "../../components/ui/type.ts";
import { parseSourceRef, sourcePlace } from "../../lib/fields.ts";
import { isPictureAnchor, useObserved } from "../../lib/media.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { findingMark, kindLabel, refKey } from "./sources.ts";

const styles = stylex.create({
  head: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  where: { color: color.textSubtle },
  message: { margin: 0, overflowWrap: "anywhere" },
  stale: { color: color.textMuted },
  fix: { color: color.textMuted },
  note: { margin: 0, color: color.textSubtle },
  chips: { display: "flex", flexWrap: "wrap", gap: space.s2, alignItems: "center" },
});

export function FindingSources({
  finding,
  index = 0,
  selected,
  onSelect,
}: {
  finding: Finding;
  /** its place in the check's findings: its chip is pressed when it opened the source panel */
  index?: number;
  selected: string;
  onSelect: (s: Source) => void;
}) {
  const observed = useObserved();
  const refs = finding.sources.map(parseSourceRef).filter((s): s is Source => !!s);
  if (!refs.length) return null;
  return (
    <div {...stylex.props(styles.chips)}>
      {refs.map((s) => (
        <SourceChip
          key={refKey(s)}
          reference={`${s.docId} ${sourcePlace(s.anchor)}`}
          quote={s.quote || undefined}
          figure={isPictureAnchor(s.anchor)}
          observed={observed(s.docId)}
          preview={videoPreview(s)}
          pressed={selected === findingMark(index, s)}
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
  sunken = where !== "Whole test",
  index,
  selected,
  onSelect,
}: {
  finding: Finding;
  stale: boolean;
  where: string;
  /** on the sunken ground (a step's finding inside the white step); false where the step itself is sunken */
  sunken?: boolean;
  /** its place in the check's findings: the card is marked when the test opened on it */
  index: number;
  selected: string;
  onSelect: (s: Source) => void;
}) {
  const head = `${kindLabel(finding.kind)}`;
  const by = finding.pass === "mechanical" ? "mechanical check" : finding.pass === "semantic" ? "read by Claude" : "";
  const on = selected === findingMark(index);
  return (
    <div role="note" aria-label={`${stale ? "Out of date · " : ""}${SEVERITY_WORD[finding.severity]} · ${head}`}>
      <Card
        density="compact"
        sunken={sunken}
        selected={on}
        title={
          <span {...stylex.props(styles.head)}>
            <SeverityBadge severity={finding.severity} />
            <span {...stylex.props(type.label)}>{head}</span>
            {stale && (
              <Badge size="sm" icon="history" label="Out of date" tooltip="The test changed after this check" />
            )}
          </span>
        }
        actions={<span {...stylex.props(type.small, styles.where)}>{by ? `${where} · ${by}` : where}</span>}
      >
        <p {...stylex.props(type.body, styles.message, stale && styles.stale)}>{finding.message}</p>
        {finding.fix && (
          <p {...stylex.props(type.compact, styles.message, stale && styles.stale)}>
            <span {...stylex.props(type.medium, styles.fix)}>Suggested fix</span> {finding.fix}
          </p>
        )}
        {stale && (
          <p {...stylex.props(type.small, styles.note)}>
            The test changed after this check. Run the check again to confirm.
          </p>
        )}
        <FindingSources finding={finding} index={index} selected={selected} onSelect={onSelect} />
        {!finding.sources.length && finding.pass === "semantic" && (
          <p {...stylex.props(type.small, styles.note)}>No passage was found for it.</p>
        )}
      </Card>
    </div>
  );
}

const SEVERITY_WORD = { error: "Error", warning: "Warning", info: "Info" } as const;
