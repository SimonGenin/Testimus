import * as stylex from "@stylexjs/stylex";
import { useContext, useState } from "react";
import { ScreenHeader } from "../../components/shell/ScreenHeader.tsx";
import { Badge } from "../../components/ui/Badge.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { List } from "../../components/ui/List.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { AppContext } from "../../lib/app.ts";
import { border, breakpoint, color, fontSize, lineHeight, size, space } from "../../styles/tokens.stylex.ts";
import { KitPage } from "./KitPage.tsx";
import { FAMILIES, type KitSection } from "./kit.tsx";

const SECTIONS = Object.values(
  import.meta.glob<KitSection>("./sections/*.tsx", { eager: true, import: "section" }),
).sort((a, b) => FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family) || a.name.localeCompare(b.name));

const styles = stylex.create({
  plain: { margin: 0 },
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
    boxSizing: "border-box",
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
  line: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  main: {
    boxSizing: "border-box",
    minHeight: 0,
    overflowY: "auto",
    padding: { default: space.s7, [breakpoint.sm]: space.s4 },
  },
});

// ponytail: the nav's second line — what the component is, its summary's first sentence
const lineOf = (s: KitSection) => s.summary.split(/(?<=[.:;])\s|\s\(/)[0].replace(/[.:;]$/, "");

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
      <ScreenHeader title="Kit" crumbs={section ? [section.name] : []}>
        <Badge label="serve --mock only" icon="info" size="sm" />
      </ScreenHeader>
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
          renderItem={(x) => ({
            title: x.name,
            meta: <span {...stylex.props(styles.line)}>{lineOf(x)}</span>,
            tooltip: x.summary,
          })}
          empty={
            <EmptyState
              compact
              icon="search"
              title={`No component named « ${filter} »`}
              text="A new need is an option first, then a wrapper — a new component only with a written reason."
            />
          }
        />
      </nav>
      <main aria-label="Component" {...stylex.props(styles.main)}>
        {section ? <KitPage section={section} /> : <p {...stylex.props(styles.plain)}>Choose a component.</p>}
      </main>
    </div>
  );
}
