import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { type } from "../../components/ui/type.ts";
import { border, color, radius, size, space } from "../../styles/tokens.stylex.ts";

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
  /** how to use it, under the preview (design/SYSTEM.md's rules for this component): anatomy, options, states, rules;
   * `code` and **strong** are marked inline */
  guidelines?: Guideline[];
  states: () => ReactNode;
};

export type Guideline = { head?: string; text?: string; items?: string[] };

const styles = stylex.create({
  grid: {
    display: "grid",
    gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, calc(${size.sidebar} - ${space.s10})), 1fr))`,
    gap: space.s4,
  },
  wide: { gridColumn: "1 / -1" },
  cell: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0, margin: 0 },
  label: { color: color.textMuted },
  stage: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s3,
    minHeight: size.controlLg,
    padding: space.s4,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
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
      <figcaption {...stylex.props(type.code, styles.label)}>{label}</figcaption>
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
  let depth2 = 0;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (depth2 === 0 && body.startsWith("/**", i)) {
      const close = body.indexOf("*/", i);
      doc = body
        .slice(i + 3, close)
        .replace(/\s*\n\s*\*\s?/g, " ")
        .trim();
      i = close + 1;
      from = i + 1;
    } else if ("{([".includes(ch)) depth2++;
    else if ("})]".includes(ch)) depth2--;
    else if (ch === ";" && depth2 === 0) {
      const m = body
        .slice(from, i)
        .trim()
        .match(/^("?[\w-]+"?)(\??):\s*([\s\S]+)$/);
      if (m)
        rows.push({ name: m[1].replaceAll('"', ""), required: m[2] !== "?", type: m[3].replace(/\s+/g, " "), doc });
      doc = "";
      from = i + 1;
    }
  }
  return rows;
}
