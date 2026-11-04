import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { breakpoint, color, fontSize, fontWeight, lineHeight, size, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  page: {
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    maxWidth: size.reading,
    paddingBlock: space.s9,
    paddingInline: { default: space.s9, [breakpoint.sm]: space.s6, [breakpoint.narrow]: space.s5 },
  },
  wide: { maxWidth: `calc(${size.reading} + ${size.sidebar})` },
  head: { display: "flex", alignItems: "flex-start", gap: space.s5, flexWrap: "wrap" },
  titles: { display: "flex", flexDirection: "column", gap: space.s2, flex: 1, minWidth: 0 },
  title: { margin: 0, fontSize: fontSize.titleLg, lineHeight: lineHeight.titleLg, fontWeight: fontWeight.semibold },
  intro: { margin: 0, fontSize: fontSize.body, lineHeight: lineHeight.body, color: color.textMuted },
  actions: { display: "flex", alignItems: "center", gap: space.s3, flexWrap: "wrap" },
  anchor: { scrollMarginTop: space.s5 },
  grid: {
    display: "grid",
    gridTemplateColumns: { default: "1fr 1fr", [breakpoint.narrow]: "1fr" },
    gap: space.s5,
    alignItems: "start",
  },
  stack: { display: "flex", flexDirection: "column", gap: space.s4 },
  hint: { margin: 0, fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
  field: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  label: { fontSize: fontSize.compact, lineHeight: lineHeight.compact, fontWeight: fontWeight.medium },
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
  intro: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`s-${id}`} {...stylex.props(styles.page, wide && styles.wide)}>
      <div {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.titles)}>
          <h2 id={`s-${id}`} {...stylex.props(styles.title)}>
            {title}
          </h2>
          <p {...stylex.props(styles.intro)}>{intro}</p>
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

export function Stack({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.stack)}>{children}</div>;
}

// ponytail: a control with its name above and a hint under (a Select, the model picker), laid out as the kit's Text
export function Labelled({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div {...stylex.props(styles.field)}>
      <label htmlFor={id} {...stylex.props(styles.label)}>
        {label}
      </label>
      {children}
      {hint && <p {...stylex.props(styles.hint)}>{hint}</p>}
    </div>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  return <p {...stylex.props(styles.hint)}>{children}</p>;
}
