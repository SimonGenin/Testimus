import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { type } from "../../components/ui/type.ts";
import { breakpoint, color, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  page: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    maxWidth: size.reading,
    paddingBlock: space.s8,
    paddingInline: { default: space.s8, [breakpoint.sm]: space.s6, [breakpoint.narrow]: space.s5 },
  },
  wide: { maxWidth: `calc(${size.reading} + ${size.sidebar} + 2 * ${space.s8})` },
  head: { display: "flex", alignItems: "flex-start", gap: space.s5, flexWrap: "wrap" },
  titles: { display: "flex", flexDirection: "column", gap: space.s2, flex: 1, minWidth: 0 },
  title: { margin: 0 },
  intro: { margin: 0, color: color.textMuted },
  actions: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  anchor: { scrollMarginTop: space.s5 },
  grid: {
    display: "grid",
    gridTemplateColumns: { default: "1fr 1fr", [breakpoint.narrow]: "1fr" },
    gap: space.s5,
    alignItems: "start",
  },
  stack: { display: "flex", flexDirection: "column", gap: space.s4 },
  loose: { gap: space.s6 },
  hint: { margin: 0, color: color.textMuted },
});

// ponytail: a settings page — its title and what it is for, then its cards; the cards a route points at
// (#/settings/<section>-<card>) are Anchors
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

// ponytail: a card the route can point at (#/settings/claude-dock) — the Card has no id of its own
export function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={`settings-${id}`} {...stylex.props(styles.anchor)}>
      {children}
    </div>
  );
}

export function Grid({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.grid)}>{children}</div>;
}

// ponytail: a card's lines, 12 px apart; loose: the groups of a card (a field and its result, then another), 24 px
export function Stack({ loose = false, children }: { loose?: boolean; children: ReactNode }) {
  return <div {...stylex.props(styles.stack, loose && styles.loose)}>{children}</div>;
}

// ponytail: a line of help under a card's controls, or alone in a card (« No quick ask yet. »); a hint that belongs to
// one control is that control's own (Text, Select, Field)
export function Hint({ children }: { children: ReactNode }) {
  return <p {...stylex.props(type.small, styles.hint)}>{children}</p>;
}
