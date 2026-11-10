import * as stylex from "@stylexjs/stylex";
import type { Finding, Source } from "../../../core/types.ts";
import { videoPreview } from "../../components/sources/VideoPreview.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { SourceChip } from "../../components/ui/SourceChip.tsx";
import { type } from "../../components/ui/type.ts";
import { type ItemLink, sourceLabel } from "../../lib/fields.ts";
import { isPictureAnchor, useObserved } from "../../lib/media.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { chipMark, findingSummary, refKey } from "./sources.ts";

const styles = stylex.create({
  ok: {
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    color: color.textMuted,
  },
  chips: { display: "flex", flexWrap: "wrap", gap: space.s2, alignItems: "center", minWidth: 0 },
  item: { display: "inline-flex", alignItems: "center", gap: space.s2, flexWrap: "wrap" },
});

const TONE = { error: "danger", warning: "warning", info: "info" } as const;
const ICON = { error: "x-circle", warning: "alert-triangle", info: "info" } as const;

// ponytail: what the check found on a step, in one badge (or a quiet « No findings »)
export function Summary({ findings, stale }: { findings: Finding[]; stale: boolean }) {
  const sum = findingSummary(findings);
  if (sum.tone === "ok")
    return (
      <span {...stylex.props(type.small, styles.ok)}>
        <Icon name="check" size="sm" />
        No findings
      </span>
    );
  return (
    <Badge
      size="sm"
      tone={stale ? "neutral" : TONE[sum.tone]}
      icon={stale ? "history" : ICON[sum.tone]}
      label={sum.text}
    />
  );
}

// ponytail: a step's sources as chips; a smart column's item names the passage it comes from
export function Links({
  links,
  step,
  selected,
  onOpen,
}: {
  links: ItemLink[];
  /** the step they belong to: a chip is pressed when it is the one that opened the source panel */
  step: number;
  selected: string;
  onOpen: (s: Source) => void;
}) {
  const observed = useObserved();
  return (
    <div {...stylex.props(styles.chips)}>
      {links.map((l, i) =>
        !l.item ? (
          l.sources.map((s) => (
            <SourceChip
              key={`${i}-${refKey(s)}-${s.quote}`}
              reference={sourceLabel(s)}
              quote={s.quote || undefined}
              figure={isPictureAnchor(s.anchor)}
              observed={observed(s.docId)}
              preview={videoPreview(s)}
              pressed={selected === chipMark(step, s)}
              onOpen={() => onOpen(s)}
            />
          ))
        ) : l.sources.length === 1 ? (
          <SourceChip
            key={l.item}
            reference={`${l.item} · ${sourceLabel(l.sources[0])}`}
            figure={isPictureAnchor(l.sources[0].anchor)}
            observed={observed(l.sources[0].docId)}
            preview={videoPreview(l.sources[0])}
            pressed={selected === chipMark(step, l.sources[0])}
            onOpen={() => onOpen(l.sources[0])}
          />
        ) : (
          <span key={l.item} {...stylex.props(styles.item)}>
            <span {...stylex.props(type.code)}>{l.item}</span>
            {l.sources.map((s) => (
              <SourceChip
                key={`${refKey(s)}-${s.quote}`}
                compact
                reference={sourceLabel(s)}
                quote={s.quote || undefined}
                preview={videoPreview(s)}
                pressed={selected === chipMark(step, s)}
                onOpen={() => onOpen(s)}
              />
            ))}
          </span>
        ),
      )}
    </div>
  );
}
