import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { border, color, container, fontSize, lineHeight, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  strip: {
    display: { default: "none", [container.reviewQueue]: "flex" },
    flex: "none",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s2,
    width: size.controlLg,
    paddingBlock: space.s3,
    borderRightWidth: border.width,
    borderRightStyle: "solid",
    borderRightColor: color.border,
    backgroundColor: color.surface,
  },
  pos: {
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontVariantNumeric: "tabular-nums",
    color: color.textMuted,
    writingMode: "vertical-rl",
  },
});

// ponytail: the queue folded when the screen is narrow (the dock open): where the open test sits, previous and next
export function QueueStrip({ at, total, onMove }: { at: number; total: number; onMove: (by: 1 | -1) => void }) {
  return (
    <nav aria-label="Review queue, folded" {...stylex.props(styles.strip)}>
      <Button
        size="sm"
        variant="quiet"
        iconOnly
        icon="chevron-up"
        label="Previous test (K)"
        disabled={!total}
        onClick={() => onMove(-1)}
      />
      <span {...stylex.props(styles.pos)} data-testid="queue-position">
        {total ? `${Math.max(0, at) + 1} / ${total}` : "0"}
      </span>
      <Button
        size="sm"
        variant="quiet"
        iconOnly
        icon="chevron-down"
        label="Next test (J)"
        disabled={!total}
        onClick={() => onMove(1)}
      />
    </nav>
  );
}
