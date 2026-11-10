import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Card } from "../../components/ui/Card.tsx";
import { type } from "../../components/ui/type.ts";
import { border, breakpoint, color, container, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  page: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
    width: "100%",
    maxWidth: `calc(${size.reading} * 5 / 4)`,
    paddingBlock: space.s8,
    paddingInline: { default: space.s8, [breakpoint.sm]: space.s6, [breakpoint.narrow]: space.s5 },
  },
  wide: { maxWidth: `calc(${size.reading} * 5 / 3)` },
  head: { display: "flex", alignItems: "flex-start", gap: space.s5, flexWrap: "wrap" },
  titles: { display: "flex", flexDirection: "column", gap: space.s2, flex: 1, minWidth: 0 },
  title: { margin: 0 },
  intro: { margin: 0, maxWidth: size.reading, color: color.textMuted },
  actions: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  anchor: { scrollMarginTop: space.s5 },
  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(calc(${size.sidebar} * 5 / 8), calc((100% - ${space.s5}) / 2))), 1fr))`,
    gap: space.s5,
    alignItems: "start",
  },
  columns: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, max(calc(${size.reading} * 3 / 4), calc((100% - ${space.s5}) / 2))), 1fr))`,
    gap: space.s5,
    alignItems: "start",
  },
  column: { display: "flex", flexDirection: "column", gap: space.s5, minWidth: 0 },
  stack: { display: "flex", flexDirection: "column", gap: space.s4 },
  loose: { gap: space.s6 },
  hint: { margin: 0, color: color.textMuted },
  row: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    minWidth: 0,
    paddingBlock: space.s5,
    paddingInline: space.s6,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
    containerType: "inline-size",
  },
  flush: { paddingInline: 0, paddingBlock: 0 },
  fact: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 2fr) minmax(0, 3fr)", [container.paneCompact]: "minmax(0, 1fr)" },
    columnGap: space.s7,
    rowGap: space.s3,
    alignItems: "start",
  },
  factSide: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  factValue: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  factHint: { color: color.textSubtle },
});

// ponytail: a settings page — its title and what it is for, then its Groups; the groups a route points at
// (#/settings/<section>-<card>) carry an id. One column of a reading width and a quarter; wide: the pages that hold a
// list beside its detail or a tryout beside its settings (Context, Search)
export function Section({
  id,
  title,
  intro,
  actions,
  wide = false,
  children,
}: {
  id: string;
  title: string;
  intro?: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`s-${id}`} {...stylex.props(styles.page, wide && styles.wide)}>
      <div {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.titles)}>
          <h2 id={`s-${id}`} {...stylex.props(type.titleLg, styles.title)}>
            {title}
          </h2>
          {intro && <p {...stylex.props(type.compact, styles.intro)}>{intro}</p>}
        </div>
        {actions && <div {...stylex.props(styles.actions)}>{actions}</div>}
      </div>
      {children}
    </section>
  );
}

// ponytail: a card the route can point at (#/settings/claudeproject-dock) — the Card has no id of its own
export function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={`settings-${id}`} {...stylex.props(styles.anchor)}>
      {children}
    </div>
  );
}

// ponytail: a group of settings — a card whose head names it (a note under the name says what the group is for)
// and whose body is Rows, one setting each, a hairline between them; id: the route can point at it
export function Group({
  id,
  title,
  note,
  actions,
  footer,
  children,
}: {
  id?: string;
  title: ReactNode;
  note?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const card = (
    <Card title={title} note={note} actions={actions} footer={footer} padded={false}>
      {children}
    </Card>
  );
  return id ? <Anchor id={id}>{card}</Anchor> : card;
}

// ponytail: one setting of a Group — a Field aside, a Fact, or a block that takes the whole width (a table: flush)
export function Row({ flush = false, children }: { flush?: boolean; children: ReactNode }) {
  return <div {...stylex.props(styles.row, flush && styles.flush)}>{children}</div>;
}

// ponytail: a row that shows a state rather than a control (Claude found, the machine, the index): its name and hint
// on the left, read out, the value and its actions on the right, laid out as a Field aside
export function Fact({ label, hint, children }: { label?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.fact)}>
      <div {...stylex.props(styles.factSide)}>
        {label && <span {...stylex.props(type.label)}>{label}</span>}
        {hint && <span {...stylex.props(type.small, styles.factHint)}>{hint}</span>}
      </div>
      <div {...stylex.props(styles.factValue)}>{children}</div>
    </div>
  );
}

// ponytail: a card's fields two by two, one under the other once the card is too narrow for two
export function Grid({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.grid)}>{children}</div>;
}

// ponytail: a page's cards in two Columns side by side when the page has room for two of three quarters of a reading
// width each; narrower, the second Column goes under the first. A lone Column takes the whole width
export function Columns({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.columns)}>{children}</div>;
}

export function Column({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.column)}>{children}</div>;
}

// ponytail: a card's lines, 12 px apart; loose: the groups of a card (a field and its result, then another), or a
// banner and the block it speaks about (the advice above the packs), 24 px
export function Stack({ loose = false, children }: { loose?: boolean; children: ReactNode }) {
  return <div {...stylex.props(styles.stack, loose && styles.loose)}>{children}</div>;
}

// ponytail: a line of help under a card's controls, or alone in a card (« No quick ask yet. »); a hint that belongs to
// one control is that control's own (Text, Select, Field)
export function Hint({ children }: { children: ReactNode }) {
  return <p {...stylex.props(type.small, styles.hint)}>{children}</p>;
}
