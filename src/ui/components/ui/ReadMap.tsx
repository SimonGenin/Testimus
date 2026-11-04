import * as stylex from "@stylexjs/stylex";
import { border, color, radius, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "./Badge.tsx";
import { type } from "./type.ts";

const styles = stylex.create({
  map: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  track: {
    position: "relative",
    height: space.s3,
    borderRadius: radius.full,
    backgroundColor: color.surfaceSunken,
    boxShadow: `inset 0 0 0 ${border.width} ${color.border}`,
    overflow: "hidden",
  },
  read: { position: "absolute", top: 0, bottom: 0, backgroundColor: color.claudeBorder },
  latest: { backgroundColor: color.claude },
  opened: { position: "absolute", top: 0, bottom: 0, minWidth: space.s2, backgroundColor: color.claude },
  cut: { position: "absolute", top: 0, bottom: 0, width: border.widthStrong, backgroundColor: color.surface },
  chapters: { display: "grid", minWidth: 0, color: color.textSubtle },
  chapter: {
    minWidth: 0,
    paddingInlineStart: space.s1,
    borderInlineStartStyle: "solid",
    borderInlineStartWidth: border.width,
    borderInlineStartColor: color.border,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  blank: { borderInlineStartColor: "transparent" },
  legend: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    color: color.textMuted,
  },
  item: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2, minWidth: 0 },
  swatch: { flex: "none", width: space.s4, height: space.s3, borderRadius: radius.full },
  swatchRead: { backgroundColor: color.claudeBorder },
  swatchOpened: { backgroundColor: color.claude },
});

export type ReadMapSection = {
  /** what the reader is shown: « §5.6 », or the heading when the anchor is a slug */
  label: string;
  /** the heading in full, as a tooltip */
  title?: string;
  /** its first and last lines */
  from: number;
  to: number;
};

export type ReadMapProps = {
  /** the document's length in lines (0 while it is not known) */
  total: number;
  /** where each chapter starts; the bar is cut there and each one is named under it, in its own share of the width */
  chapters?: { label: string; title?: string; line: number }[];
  /** the lines read directly, as ranges */
  read?: { from: number; to: number }[];
  /** the sections opened from the index, over their whole extent */
  opened?: ReadMapSection[];
  /** a run still going: its last range is drawn as the one being read */
  live?: boolean;
  /** the legend of what was read (« Lines 1–26 of 30, front to back · … »), written by the owner */
  summary?: string;
  /** the accessible name of the bar */
  label?: string;
};

// ponytail: a chapter narrower than this share of the document keeps its cut in the bar but not its name under it
const NAMED = 0.08;

const pct = (n: number, total: number) => `${(n / total) * 100}%`;

// ponytail: where in a document Claude read (design _docs.mjs docBar) — the document's lines as a bar cut by chapter,
// the lines read in Claude's light tone, the sections opened from the index in its full tone over their extent, the
// chapters named under the bar in a grid that follows their length (a name never runs over the next one), and a legend
export function ReadMap({ total, chapters = [], read = [], opened = [], live = false, summary, label }: ReadMapProps) {
  const starts = chapters.filter((c) => c.line >= 1 && c.line <= total).sort((a, b) => a.line - b.line);
  const parts = [
    ...(starts.length && starts[0].line > 1 ? [{ from: 1, to: starts[0].line - 1, chapter: undefined }] : []),
    ...starts.map((c, i) => ({ from: c.line, to: (starts[i + 1]?.line ?? total + 1) - 1, chapter: c })),
  ].filter((p) => p.to >= p.from);
  const named = total > 0 && parts.some((p) => p.chapter && (p.to - p.from + 1) / total >= NAMED);
  const said = [
    read.length ? `lines read: ${read.map((r) => `${r.from} to ${r.to}`).join(", ")}` : "",
    opened.length ? `sections opened from the index: ${opened.map((o) => o.label).join(", ")}` : "",
  ].filter(Boolean);
  return (
    <div {...stylex.props(styles.map)}>
      <div
        role="img"
        aria-label={`${label ?? "Where Claude read"}${total ? `, ${total} lines` : ""}: ${said.join("; ") || "nothing yet"}`}
        {...stylex.props(styles.track)}
      >
        {total > 0 &&
          read.map((r, i) => (
            <span
              key={`r${i}`}
              data-part={live && i === read.length - 1 ? "latest" : "read"}
              style={{ left: pct(r.from - 1, total), width: pct(r.to - r.from + 1, total) }}
              {...stylex.props(styles.read, live && i === read.length - 1 && styles.latest)}
            />
          ))}
        {total > 0 &&
          opened
            .filter((o) => o.from >= 1 && o.to >= o.from)
            .map((o) => (
              <span
                key={`o${o.label}${o.from}`}
                data-part="opened"
                style={{ left: pct(o.from - 1, total), width: pct(o.to - o.from + 1, total) }}
                {...stylex.props(styles.opened)}
              />
            ))}
        {total > 0 &&
          starts
            .filter((c) => c.line > 1)
            .map((c) => (
              <span
                key={`c${c.line}`}
                data-part="chapter"
                style={{ left: pct(c.line - 1, total) }}
                {...stylex.props(styles.cut)}
              />
            ))}
      </div>
      {named && (
        <div
          aria-hidden="true"
          data-part="chapters"
          style={{ gridTemplateColumns: parts.map((p) => `minmax(0, ${p.to - p.from + 1}fr)`).join(" ") }}
          {...stylex.props(type.caption, type.regular, styles.chapters)}
        >
          {parts.map((p) => {
            const shown = p.chapter && (p.to - p.from + 1) / total >= NAMED;
            return (
              <span
                key={p.from}
                title={shown ? (p.chapter?.title ?? p.chapter?.label) : undefined}
                {...stylex.props(styles.chapter, !shown && styles.blank)}
              >
                {shown ? p.chapter?.label : ""}
              </span>
            );
          })}
        </div>
      )}
      {(summary || opened.length > 0) && (
        <ul {...stylex.props(type.small, styles.legend)}>
          {summary && (
            <li {...stylex.props(styles.item)}>
              <i aria-hidden="true" {...stylex.props(styles.swatch, styles.swatchRead)} />
              {summary}
            </li>
          )}
          {opened.length > 0 && (
            <li {...stylex.props(styles.item)}>
              <i aria-hidden="true" {...stylex.props(styles.swatch, styles.swatchOpened)} />
              {opened.length === 1 ? "1 section" : `${opened.length} sections`} opened from the index
              {opened.map((o) => (
                <Badge key={`${o.label}${o.from}`} label={o.label} tone="claude" size="sm" tooltip={o.title} />
              ))}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
