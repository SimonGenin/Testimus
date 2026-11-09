import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Table } from "../../components/ui/Table.tsx";
import { type } from "../../components/ui/type.ts";
import { border, breakpoint, color, darkTheme, lightTheme, radius, size, space } from "../../styles/tokens.stylex.ts";
import { type Guideline, type KitSection, type PropRow, propsOf } from "./kit.tsx";

const SOURCES = import.meta.glob<string>("../../components/ui/**/*.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
});
const sourceOf = (file: string) => SOURCES[`../../components/ui/${file}`] ?? "";

const styles = stylex.create({
  page: { display: "flex", flexDirection: "column", gap: space.s7 },
  head: { display: "flex", flexDirection: "column", gap: space.s3, maxWidth: size.reading },
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s3 },
  title: { margin: 0 },
  mono: { color: color.textMuted },
  summary: { margin: 0 },
  columns: {
    display: "grid",
    gridTemplateColumns: { default: "minmax(0, 2fr) minmax(0, 3fr)", [breakpoint.wide]: "minmax(0, 1fr)" },
    gap: space.s7,
    alignItems: "start",
  },
  sec: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  secTitle: { display: "flex", alignItems: "center", gap: space.s3, margin: 0 },
  grow: { flex: 1 },
  prop: { display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: space.s2 },
  propName: { whiteSpace: "nowrap" },
  propType: { display: "block", color: color.textMuted, overflowWrap: "anywhere" },
  propDoc: { display: "block", color: color.textMuted },
  previews: { display: "flex", flexDirection: "column", gap: space.s4 },
  theme: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s4,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.canvas,
    color: color.text,
  },
  guide: { display: "flex", flexDirection: "column", gap: space.s4, maxWidth: size.reading },
  para: { margin: 0 },
  list: { display: "flex", flexDirection: "column", gap: space.s2, margin: 0, paddingInlineStart: space.s6 },
  code: {
    paddingInline: space.s1,
    borderRadius: radius.r1,
    backgroundColor: color.surfaceSunken,
  },
});

// ponytail: the guidelines' inline marks as elements — `code` in mono, **strong** in bold; a lone *word* loses its
// stars (no italics in the interface)
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) => {
    const key = `${i}-${part}`;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1)
      return (
        <code key={key} {...stylex.props(type.code, styles.code)}>
          {part.slice(1, -1)}
        </code>
      );
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={key}>{part.slice(2, -2)}</strong>;
    return part.replace(/(^|[\s(«])\*([^*\s][^*]*?)\*(?=[\s).,;:»]|$)/g, "$1$2");
  });
}

function Guidelines({ items }: { items: Guideline[] }) {
  return (
    <section aria-label="Guidelines" {...stylex.props(styles.sec)}>
      <h2 {...stylex.props(type.titleSm, styles.secTitle)}>Guidelines</h2>
      <div {...stylex.props(type.compact, styles.guide)}>
        {items.map((g) => (
          <div key={g.head ?? g.text ?? g.items?.[0]}>
            {(g.head || g.text) && (
              <p {...stylex.props(styles.para)}>
                {g.head && <strong>{g.head}. </strong>}
                {g.text && inline(g.text)}
              </p>
            )}
            {g.items && (
              <ul {...stylex.props(styles.list)}>
                {g.items.map((it) => (
                  <li key={it}>{inline(it)}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

const typesOf = (name: string, rows: PropRow[]) =>
  `export type ${name}Props = {\n${rows
    .map((r) => `${r.doc ? `  /** ${r.doc} */\n` : ""}  ${r.name}${r.required ? "" : "?"}: ${r.type};`)
    .join("\n")}\n};\n`;

function Props({ section }: { section: KitSection }) {
  const rows = propsOf(sourceOf(section.file), section.name);
  return (
    <section aria-label="Props" {...stylex.props(styles.sec)}>
      <h2 {...stylex.props(type.titleSm, styles.secTitle)}>
        Props
        <span {...stylex.props(type.code, styles.mono)}>{section.name}Props</span>
        <span {...stylex.props(styles.grow)} />
        <Button
          variant="quiet"
          size="sm"
          icon="copy"
          label="Copy the types"
          disabled={rows.length === 0 ? "No props type to copy" : undefined}
          onClick={() => void navigator.clipboard?.writeText(typesOf(section.name, rows)).catch(() => {})}
        />
      </h2>
      <Table
        label={`${section.name} props`}
        dense
        getKey={(r) => r.name}
        rows={rows}
        empty="This component reads no props."
        columns={[
          {
            key: "name",
            label: "Prop",
            width: "30%",
            render: (r) => (
              <span {...stylex.props(styles.prop)}>
                <span {...stylex.props(type.code, styles.propName)}>{r.name}</span>
                {r.required && <Badge label="required" size="sm" />}
              </span>
            ),
          },
          {
            key: "type",
            label: "Type and use",
            render: (r) => (
              <>
                <span {...stylex.props(type.code, styles.propType)}>{r.type}</span>
                {r.doc && <span {...stylex.props(type.small, styles.propDoc)}>{r.doc}</span>}
              </>
            ),
          },
        ]}
      />
    </section>
  );
}

function ThemePanel({ name, theme, section }: { name: string; theme: typeof lightTheme; section: KitSection }) {
  return (
    <section aria-label={`${section.name}, ${name}`} {...stylex.props(...theme, styles.theme)}>
      <span {...stylex.props(type.caption)}>{name}</span>
      {section.states()}
    </section>
  );
}

// ponytail: one component's page — its name, family and file, what it is for, its props read from its source, every
// state light and dark side by side, then how to use it
export function KitPage({ section }: { section: KitSection }) {
  return (
    <article aria-labelledby="kit-title" {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.row)}>
          <h1 id="kit-title" {...stylex.props(type.titleLg, styles.title)}>
            {section.name}
          </h1>
          <Badge label={section.family} size="sm" />
          <span {...stylex.props(type.code, styles.mono)}>src/ui/components/ui/{section.file}</span>
        </div>
        <p {...stylex.props(styles.summary)}>{section.summary}</p>
        {section.note && (
          <Banner tone="neutral" compact>
            {section.note}
          </Banner>
        )}
      </header>
      <div {...stylex.props(styles.columns)}>
        <Props section={section} />
        <section aria-label="States and options" {...stylex.props(styles.sec)}>
          <h2 {...stylex.props(type.titleSm, styles.secTitle)}>States and options</h2>
          <div {...stylex.props(styles.previews)}>
            <ThemePanel name="Light" theme={lightTheme} section={section} />
            <ThemePanel name="Dark" theme={darkTheme} section={section} />
          </div>
        </section>
      </div>
      {section.guidelines && <Guidelines items={section.guidelines} />}
    </article>
  );
}
