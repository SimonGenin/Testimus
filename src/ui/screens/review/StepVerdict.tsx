import * as stylex from "@stylexjs/stylex";
import type { Source, StepVerdict as Verdict } from "../../../core/types.ts";
import { videoPreview } from "../../components/sources/VideoPreview.tsx";
import { Badge, STEP_VERDICT } from "../../components/ui/Badge.tsx";
import { SourceChip } from "../../components/ui/SourceChip.tsx";
import { type } from "../../components/ui/type.ts";
import { parseSourceRef, sourceLabel } from "../../lib/fields.ts";
import { isPictureAnchor, useObserved } from "../../lib/media.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { chipMark } from "./sources.ts";

const styles = stylex.create({
  line: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: space.s3,
    rowGap: space.s2,
    minWidth: 0,
    color: color.textMuted,
  },
  marks: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s2 },
  why: { minWidth: 0, overflowWrap: "anywhere" },
  read: { display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, minWidth: 0 },
});

const STALE = "The test changed after this check. Run the check again to confirm.";

// ponytail: what the check says of one step, findings or not — a supported step is a quiet line, so a test without a
// finding still shows that each step was read against a passage, and which; an unsupported or unjudged one is a state,
// and a verdict whose passages the run never opened (the core's own word) is said as a warning. compact: the words
// alone, in a folded step's head
export function StepVerdict({
  verdict,
  stale,
  compact = false,
  step = verdict.step,
  selected = "",
  onOpen,
}: {
  verdict: Verdict;
  /** the test changed after the check: the verdict is said, muted */
  stale: boolean;
  compact?: boolean;
  step?: number;
  /** the mark of the element that opened the source panel (sources.ts chipMark) */
  selected?: string;
  /** a passage the check read, opened like a source of the step */
  onOpen?: (s: Source) => void;
}) {
  const observed = useObserved();
  const word = STEP_VERDICT[verdict.verdict] ?? STEP_VERDICT.unverified;
  const marks = (
    <span {...stylex.props(styles.marks)}>
      {stale ? (
        <Badge size="sm" quiet icon="history" label={word.label} tooltip={STALE} />
      ) : (
        <Badge {...word} size="sm" quiet={verdict.verdict === "supported"} />
      )}
      {verdict.opened === false && <Badge {...STEP_VERDICT["not-opened"]} size="sm" />}
    </span>
  );
  if (compact) return marks;
  const refs = verdict.read.map((r) => ({ r, source: parseSourceRef(r) }));
  return (
    <div role="note" aria-label={`Check verdict · ${word.label}`} {...stylex.props(type.small, styles.line)}>
      {marks}
      {verdict.why && <span {...stylex.props(styles.why)}>— {verdict.why}</span>}
      {refs.length > 0 ? (
        <span {...stylex.props(styles.read)}>
          <span>{verdict.why ? "read" : "— read"}</span>
          {refs.map(({ r, source }) =>
            source ? (
              <SourceChip
                key={r}
                compact
                reference={sourceLabel(source)}
                figure={isPictureAnchor(source.anchor)}
                observed={observed(source.docId)}
                preview={videoPreview(source)}
                pressed={selected === chipMark(step, source)}
                onOpen={onOpen && (() => onOpen(source))}
              />
            ) : (
              <span key={r} {...stylex.props(type.code)}>
                {r}
              </span>
            ),
          )}
        </span>
      ) : (
        !verdict.why && <span>— no passage named</span>
      )}
    </div>
  );
}
