import * as stylex from "@stylexjs/stylex";
import { Fragment, type ReactNode } from "react";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { type } from "./type.ts";

const styles = stylex.create({
  facts: {
    display: "grid",
    gridTemplateColumns: "max-content minmax(0, 1fr)",
    rowGap: space.s2,
    columnGap: space.s5,
    alignItems: "baseline",
    margin: 0,
    minWidth: 0,
  },
  term: { color: color.textMuted },
  value: { margin: 0, minWidth: 0, overflowWrap: "anywhere" },
  divided: { rowGap: 0 },
  row: {
    paddingBlock: space.s3,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  first: { borderTopWidth: 0, paddingBlockStart: 0 },
});

export type Fact = { label: string; value: ReactNode };

export type FactsProps = {
  /** one row per fact, the name on the left, its value on the right; a false or empty row is left out, so a list can
   * hold the rows that apply only sometimes */
  items: (Fact | false | null | undefined)[];
  /** md (default): compact text, in a card or a page · sm: small text, in a dense meta block (a figure, a pack) */
  size?: "sm" | "md";
  /** the accessible name of the list */
  label?: string;
  /** a hairline between the rows, each row with room around it (a plan, a measure: facts read one by one) */
  divided?: boolean;
};

// ponytail: facts about one thing, as name and value (shell.mjs .kv) — a model pack, a figure, the program found, a
// result's numbers; the one key-value list of the app
export function Facts({ items, size = "md", label, divided = false }: FactsProps) {
  const shown = items.filter((f): f is Fact => !!f);
  return (
    <dl
      aria-label={label}
      {...stylex.props(size === "sm" ? type.small : type.compact, styles.facts, divided && styles.divided)}
    >
      {shown.map((f, i) => (
        <Fragment key={f.label}>
          <dt {...stylex.props(styles.term, divided && styles.row, divided && i === 0 && styles.first)}>{f.label}</dt>
          <dd {...stylex.props(styles.value, divided && styles.row, divided && i === 0 && styles.first)}>{f.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
