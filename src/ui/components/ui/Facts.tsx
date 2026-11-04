import * as stylex from "@stylexjs/stylex";
import { Fragment, type ReactNode } from "react";
import { color, space } from "../../styles/tokens.stylex.ts";
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
};

// ponytail: facts about one thing, as name and value (shell.mjs .kv) — a model pack, a figure, the program found, a
// result's numbers; the one key-value list of the app
export function Facts({ items, size = "md", label }: FactsProps) {
  const shown = items.filter((f): f is Fact => !!f);
  return (
    <dl aria-label={label} {...stylex.props(size === "sm" ? type.small : type.compact, styles.facts)}>
      {shown.map((f) => (
        <Fragment key={f.label}>
          <dt {...stylex.props(styles.term)}>{f.label}</dt>
          <dd {...stylex.props(styles.value)}>{f.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
