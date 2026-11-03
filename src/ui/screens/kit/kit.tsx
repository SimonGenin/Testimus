import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { border, color, fontFamily, fontSize, lineHeight, radius, size, space } from "../../styles/tokens.stylex.ts";

export const FAMILIES = [
  "Foundations",
  "Actions",
  "Inputs",
  "Claude",
  "Collections",
  "Navigation",
  "Overlays",
  "Status",
  "Feedback",
  "Layout",
] as const;

export type Family = (typeof FAMILIES)[number];

// ponytail: one file per kit component in sections/, found by the screen without a shared list (each kit agent adds
// its own); `file` names the component's source in components/ui, whose *Props type is shown as the props table
export type KitSection = {
  name: string;
  family: Family;
  file: string;
  summary: string;
  /** why it exists when it extends the N2 list (option, then wrapper, then new) */
  note?: string;
  states: () => ReactNode;
};

const styles = stylex.create({
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))", gap: space.s4 },
  wide: { gridColumn: "1 / -1" },
  cell: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0, margin: 0 },
  label: { fontFamily: fontFamily.mono, fontSize: fontSize.code, lineHeight: lineHeight.code, color: color.textMuted },
  stage: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s3,
    minHeight: size.controlLg,
    padding: space.s4,
    borderStyle: "dashed",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r2,
    backgroundColor: color.surface,
  },
  column: { flexDirection: "column", alignItems: "stretch" },
});

export function States({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.grid)}>{children}</div>;
}

// ponytail: one state of one component, named the way the design names it
export function Cell({
  label,
  children,
  wide = false,
  column = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
  column?: boolean;
}) {
  return (
    <figure aria-label={label} {...stylex.props(styles.cell, wide && styles.wide)}>
      <figcaption {...stylex.props(styles.label)}>{label}</figcaption>
      <div {...stylex.props(styles.stage, column && styles.column)}>{children}</div>
    </figure>
  );
}

export type PropRow = { name: string; required: boolean; type: string; doc: string };

// ponytail: the props table is the component's own `export type <Name>Props = { … }`, read from its source text
export function propsOf(source: string, name: string): PropRow[] {
  const start = source.search(new RegExp(`export type ${name}Props(<[^>]*>)? = `));
  if (start < 0) return [];
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      end = i;
      break;
    }
  }
  const body = source.slice(open + 1, end);
  const rows: PropRow[] = [];
  let doc = "";
  for (const m of body.matchAll(/\/\*\*([\s\S]*?)\*\/|^ {2}("?[\w-]+"?)(\??): ([^;]+);/gm)) {
    if (m[1] !== undefined) doc = m[1].replace(/\s*\n\s*\*\s?/g, " ").trim();
    else {
      rows.push({ name: m[2].replaceAll('"', ""), required: m[3] !== "?", type: m[4].trim(), doc });
      doc = "";
    }
  }
  return rows;
}
