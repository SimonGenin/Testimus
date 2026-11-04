import * as stylex from "@stylexjs/stylex";
import { useContext, useState } from "react";
import { Banner } from "../../components/ui/Banner.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { List } from "../../components/ui/List.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { AppContext } from "../../lib/app.ts";
import {
  border,
  breakpoint,
  color,
  darkTheme,
  fontFamily,
  fontSize,
  fontWeight,
  lightTheme,
  lineHeight,
  radius,
  shadow,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { FAMILIES, type KitSection, propsOf } from "./kit.tsx";

const SECTIONS = Object.values(
  import.meta.glob<KitSection>("./sections/*.tsx", { eager: true, import: "section" }),
).sort((a, b) => FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family) || a.name.localeCompare(b.name));

const SOURCES = import.meta.glob<string>("../../components/ui/*.tsx", {
  eager: true,
  query: "?raw",
  import: "default",
});
const sourceOf = (file: string) => SOURCES[`../../components/ui/${file}`] ?? "";

const styles = stylex.create({
  screen: {
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns: `${size.sidebar} 1fr`,
    height: "100%",
    minHeight: 0,
    backgroundColor: color.canvas,
    color: color.text,
  },
  nav: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    minHeight: 0,
    overflowY: "auto",
    padding: space.s4,
    borderInlineEndStyle: "solid",
    borderInlineEndWidth: border.width,
    borderInlineEndColor: color.border,
    backgroundColor: color.surface,
  },
  count: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textSubtle },
  group: { display: "flex", flexDirection: "column", gap: space.s1 },
  groupHead: {
    display: "flex",
    justifyContent: "space-between",
    marginTop: space.s3,
    fontSize: fontSize.caption,
    lineHeight: lineHeight.caption,
    fontWeight: fontWeight.medium,
    color: color.textMuted,
  },
  main: { minHeight: 0, overflowY: "auto", padding: { default: space.s7, [breakpoint.sm]: space.s4 } },
  head: { display: "flex", flexDirection: "column", gap: space.s2, marginBottom: space.s5 },
  title: { margin: 0, fontSize: fontSize.titleLg, lineHeight: lineHeight.titleLg, fontWeight: fontWeight.semibold },
  meta: { fontFamily: fontFamily.mono, fontSize: fontSize.code, color: color.textMuted },
  summary: { margin: 0, maxWidth: size.reading, color: color.textMuted },
  columns: {
    display: "grid",
    gridTemplateColumns: { default: `minmax(0, 2fr) minmax(0, 3fr)`, [breakpoint.wide]: "minmax(0, 1fr)" },
    gap: space.s5,
    alignItems: "start",
  },
  card: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s5,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r3,
    backgroundColor: color.surface,
    boxShadow: shadow.s1,
  },
  cardTitle: { margin: 0, fontSize: fontSize.titleSm, lineHeight: lineHeight.titleSm, fontWeight: fontWeight.semibold },
  prop: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)",
    gap: space.s3,
    paddingBlock: space.s2,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
  },
  propName: { fontFamily: fontFamily.mono, fontSize: fontSize.code },
  propType: { fontFamily: fontFamily.mono, fontSize: fontSize.code, color: color.textLink, overflowWrap: "anywhere" },
  propDoc: { color: color.textMuted },
  previews: { display: "flex", flexDirection: "column", gap: space.s4 },
  theme: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    padding: space.s4,
    borderRadius: radius.r3,
    backgroundColor: color.canvas,
    color: color.text,
  },
  themeName: { fontSize: fontSize.caption, fontWeight: fontWeight.medium, color: color.textMuted },
});

function ThemePanel({ name, theme, section }: { name: string; theme: typeof lightTheme; section: KitSection }) {
  return (
    <section aria-label={`${section.name}, ${name}`} {...stylex.props(...theme, styles.theme)}>
      <span {...stylex.props(styles.themeName)}>{name}</span>
      {section.states()}
    </section>
  );
}

function Page({ section }: { section: KitSection }) {
  const rows = propsOf(sourceOf(section.file), section.name);
  return (
    <article aria-labelledby="kit-title">
      <header {...stylex.props(styles.head)}>
        <h1 id="kit-title" {...stylex.props(styles.title)}>
          {section.name}
        </h1>
        <span {...stylex.props(styles.meta)}>
          {section.family} · src/ui/components/ui/{section.file}
        </span>
        <p {...stylex.props(styles.summary)}>{section.summary}</p>
        {section.note && (
          <Banner tone="neutral" compact>
            {section.note}
          </Banner>
        )}
      </header>
      <div {...stylex.props(styles.columns)}>
        <section aria-label="Props" {...stylex.props(styles.card)}>
          <h2 {...stylex.props(styles.cardTitle)}>Props</h2>
          {rows.map((r) => (
            <div key={r.name} {...stylex.props(styles.prop)}>
              <span {...stylex.props(styles.propName)}>
                {r.name}
                {r.required ? "" : "?"}
              </span>
              <span>
                <span {...stylex.props(styles.propType)}>{r.type}</span>
                {r.doc && <span {...stylex.props(styles.propDoc)}> — {r.doc}</span>}
              </span>
            </div>
          ))}
        </section>
        <div {...stylex.props(styles.previews)}>
          <ThemePanel name="Light" theme={lightTheme} section={section} />
          <ThemePanel name="Dark" theme={darkTheme} section={section} />
        </div>
      </div>
    </article>
  );
}

// ponytail: the kit catalogue (N5) — every component of components/ui in each of its states and options, light and dark;
// it is where a component is changed from, and Playwright shoots it into tests/screens/kit/
export function KitScreen() {
  const app = useContext(AppContext);
  const [filter, setFilter] = useState("");
  const [local, setLocal] = useState<string | undefined>(undefined);
  const current = app?.route.arg ?? local ?? SECTIONS[0]?.name;
  const go = (name: string) => (app ? app.navigate("kit", name) : setLocal(name));
  const shown = SECTIONS.filter((s) => s.name.toLowerCase().includes(filter.trim().toLowerCase()));
  const section = SECTIONS.find((s) => s.name === current);
  return (
    <div {...stylex.props(styles.screen)}>
      <nav aria-label="Components" {...stylex.props(styles.nav)}>
        <Text
          ariaLabel="Filter components"
          icon="search"
          placeholder="Filter components"
          value={filter}
          onChange={setFilter}
        />
        <span {...stylex.props(styles.count)}>
          {filter.trim()
            ? `${shown.length} of ${SECTIONS.length} components match`
            : `${SECTIONS.length} components · one per control, options before copies`}
        </span>
        <List
          label="Components"
          items={shown}
          getKey={(x) => x.name}
          selected={current ?? null}
          onSelect={go}
          groups={FAMILIES.map((family) => ({
            label: family,
            meta: String(shown.filter((x) => x.family === family).length),
            keys: shown.filter((x) => x.family === family).map((x) => x.name),
          })).filter((g) => g.keys.length > 0)}
          renderItem={(x) => ({ title: x.name })}
          empty={<EmptyState compact icon="search" title={`No component named « ${filter} »`} />}
        />
      </nav>
      <main aria-label="Component" {...stylex.props(styles.main)}>
        {section ? <Page section={section} /> : <p>Choose a component.</p>}
      </main>
    </div>
  );
}
