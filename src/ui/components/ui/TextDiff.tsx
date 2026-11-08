import * as stylex from "@stylexjs/stylex";
import { lineDiff, withContext } from "../../lib/textDiff.ts";
import { color, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";
import { Icon } from "./Icon.tsx";
import { type } from "./type.ts";

const styles = stylex.create({
  diff: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    margin: 0,
    paddingBlock: space.s3,
    paddingInline: 0,
    listStyle: "none",
    minWidth: 0,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    overflow: "auto",
  },
  line: {
    display: "grid",
    gridTemplateColumns: `${space.s6} minmax(0, 1fr)`,
    alignItems: "start",
    minHeight: lineHeight.code,
    paddingInlineEnd: space.s4,
    color: color.textMuted,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  },
  added: { backgroundColor: color.successSubtle, color: color.text, textDecoration: "none" },
  removed: { backgroundColor: color.dangerSubtle, color: color.text, textDecoration: "none" },
  sign: { display: "inline-flex", justifyContent: "center", paddingTop: space.s1 },
  plus: { color: color.success },
  minus: { color: color.danger },
  skipped: { paddingInline: space.s6, color: color.textSubtle },
  same: { display: "block", textAlign: "center", color: color.textSubtle },
});

export type TextDiffProps = {
  before: string;
  after: string;
  /** unchanged lines kept around each change; the others fold into « N unchanged lines » */
  context?: number;
  /** the accessible name (« Changes of the last update ») */
  label: string;
};

// ponytail: what changed between two versions of a text, line by line — a line added on green with « + », a line
// removed on red with « − » (each one's icon says it in words), the unchanged lines far from a change folded
export function TextDiff({ before, after, context = 2, label }: TextDiffProps) {
  const lines = lineDiff(before, after);
  if (!lines.some((l) => l.kind !== "same")) return <p {...stylex.props(type.compact, styles.same)}>No difference.</p>;
  return (
    <ul aria-label={label} {...stylex.props(type.code, styles.diff)}>
      {withContext(lines, context).map((p, k) =>
        p.kind === "skipped" ? (
          <li key={k} {...stylex.props(type.small, styles.skipped)}>
            {p.count} unchanged line{p.count === 1 ? "" : "s"}
          </li>
        ) : (
          <li
            key={k}
            data-kind={p.kind}
            {...stylex.props(styles.line, p.kind === "added" && styles.added, p.kind === "removed" && styles.removed)}
          >
            <span {...stylex.props(styles.sign, p.kind === "added" ? styles.plus : styles.minus)}>
              {p.kind === "added" ? (
                <Icon name="plus" size="sm" label="Added" />
              ) : p.kind === "removed" ? (
                <Icon name="minus" size="sm" label="Removed" />
              ) : null}
            </span>
            <span>{p.text || " "}</span>
          </li>
        ),
      )}
    </ul>
  );
}
