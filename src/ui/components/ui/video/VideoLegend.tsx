import * as stylex from "@stylexjs/stylex";
import { clock } from "../../../lib/media.ts";
import { color, radius, space } from "../../../styles/tokens.stylex.ts";
import { type } from "../type.ts";
import type { VideoRange } from "../Video.tsx";
import { tones } from "./tones.ts";

const styles = stylex.create({
  line: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "space-between",
    columnGap: space.s4,
    color: color.textSubtle,
  },
  legend: { display: "inline-flex", flexWrap: "wrap", columnGap: space.s4 },
  item: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  swatch: { flex: "none", width: space.pill, height: space.snug, borderRadius: radius.mark },
});

export type VideoLegendProps = {
  time: number;
  duration: number;
  /** the cited range: the line says it and the margin played around it */
  cited?: VideoRange;
  margin: number;
};

// ponytail: under the timeline, the clock (« 02:44 / 04:20 ») and what the two tones of the timeline mean
export function VideoLegend({ time, duration, cited, margin }: VideoLegendProps) {
  return (
    <div {...stylex.props(type.code, type.tabular, styles.line)}>
      <span>
        {clock(time)} / {clock(duration)}
      </span>
      {cited && (
        <span {...stylex.props(styles.legend)}>
          <span {...stylex.props(styles.item)}>
            <i aria-hidden="true" {...stylex.props(styles.swatch, tones.cited)} />
            cited {clock(cited.from)} → {clock(cited.to)}
          </span>
          <span {...stylex.props(styles.item)}>
            <i aria-hidden="true" {...stylex.props(styles.swatch, tones.margin)} />
            margin {margin} s
          </span>
        </span>
      )}
    </div>
  );
}
