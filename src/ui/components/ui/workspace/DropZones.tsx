import * as stylex from "@stylexjs/stylex";
import type { Zone } from "../../../lib/workspace/zones.ts";
import { border, color, radius, size, space, z } from "../../../styles/tokens.stylex.ts";
import { type } from "../type.ts";

const styles = stylex.create({
  over: {
    position: "absolute",
    insetInline: 0,
    bottom: 0,
    top: size.controlLg,
    zIndex: z.sticky,
    display: "grid",
    gridTemplateColumns: "1fr 3fr 1fr",
    gridTemplateRows: "3fr 4fr 3fr",
    gap: space.s2,
    padding: space.s3,
    pointerEvents: "none",
  },
  zone: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: space.s2,
    borderWidth: border.width,
    borderStyle: "dashed",
    borderColor: color.accent,
    borderRadius: radius.r2,
    backgroundColor: color.accentSubtle,
    color: color.accentText,
    textAlign: "center",
    opacity: 0.6,
  },
  side: { gridRow: "1 / 4", writingMode: "vertical-rl" },
  left: { gridColumn: "1" },
  right: { gridColumn: "3" },
  above: { gridColumn: "2", gridRow: "1" },
  center: { gridColumn: "2", gridRow: "2" },
  below: { gridColumn: "2", gridRow: "3" },
  lit: {
    opacity: 1,
    borderStyle: "solid",
    borderWidth: border.widthStrong,
    backgroundColor: color.accent,
    color: color.onAccent,
  },
  refused: {
    opacity: 1,
    borderStyle: "solid",
    borderColor: color.danger,
    backgroundColor: color.dangerSubtle,
    color: color.danger,
  },
  marker: {
    position: "absolute",
    top: space.s2,
    width: border.widthStrong,
    height: `calc(${size.controlLg} - ${space.s3})`,
    zIndex: z.sticky,
    backgroundColor: color.accent,
    pointerEvents: "none",
  },
  markerAt: (left: string) => ({ left }),
  bar: {
    position: "absolute",
    insetInline: 0,
    top: 0,
    height: size.controlLg,
    zIndex: z.sticky,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingInline: space.s3,
    pointerEvents: "none",
  },
  reason: {
    paddingInline: space.s3,
    paddingBlock: space.s1,
    borderRadius: radius.full,
    backgroundColor: color.dangerSubtle,
    color: color.danger,
  },
});

const WORDS: Record<Exclude<Zone, "tabs">, string> = {
  left: "New column on the left",
  right: "New column on the right",
  above: "Split: above",
  center: "Add as a tab here",
  below: "Split: below",
};

// ponytail: what a dragged tab would do where it is now — the five places of a section (its edges open a column or
// split it, its middle takes the tab), the one under the pointer lit, or crossed out with the reason it cannot go there;
// over the tab bar, a line where it would sit among the others
export function DropZones({ zone, marker, refused }: { zone: Zone; marker: number | null; refused: string | null }) {
  if (zone === "tabs")
    return (
      <>
        {marker !== null && !refused && (
          <span aria-hidden="true" {...stylex.props(styles.marker, styles.markerAt(`${marker}px`))} />
        )}
        {refused && (
          <span role="status" {...stylex.props(styles.bar)}>
            <span {...stylex.props(type.small, type.medium, styles.reason)}>{refused}</span>
          </span>
        )}
      </>
    );
  return (
    <div {...stylex.props(styles.over)}>
      {(Object.keys(WORDS) as (keyof typeof WORDS)[]).map((k) => (
        <span
          key={k}
          role={k === zone ? "status" : undefined}
          {...stylex.props(
            type.small,
            type.medium,
            styles.zone,
            (k === "left" || k === "right") && styles.side,
            styles[k],
            k === zone && (refused ? styles.refused : styles.lit),
          )}
        >
          {k === zone && refused ? refused : WORDS[k]}
        </span>
      ))}
    </div>
  );
}
