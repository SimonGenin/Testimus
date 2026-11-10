import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Kbd } from "../../components/ui/Kbd.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { type } from "../../components/ui/type.ts";
import { desktop, setAlwaysOnTop } from "../../lib/desktop.ts";
import { usePref } from "../../lib/prefs.ts";
import { type Theme, useTheme } from "../../lib/theme.ts";
import { color, darkTheme, lightTheme, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Fact, Group, Row, Section } from "./Section.tsx";

const styles = stylex.create({
  tiles: { display: "flex", flexWrap: "wrap", gap: space.s4 },
  tile: { width: `calc(${size.controlLg} * 3)` },
  mini: {
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    height: size.row2,
    padding: space.s3,
    borderRadius: radius.r1,
    backgroundColor: color.canvas,
  },
  half: { display: "flex", height: size.row2, borderRadius: radius.r1, overflow: "hidden" },
  halfSide: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    padding: space.s3,
    backgroundColor: color.canvas,
  },
  bar: { height: space.s2, width: "70%", borderRadius: radius.r1, backgroundColor: color.borderField },
  barShort: { width: "45%", backgroundColor: color.borderStrong },
  dot: { marginTop: "auto", height: space.s4, width: "40%", borderRadius: radius.r1, backgroundColor: color.accent },
  steps: { display: "flex", flexDirection: "column", gap: space.s2, height: size.row2, padding: space.s3 },
  stepsSide: { flexDirection: "row" },
  step: { flex: 1, borderRadius: radius.r1, backgroundColor: color.surfaceSunken },
  keys: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2, color: color.textMuted },
});

function Page({ dark = false, half = false }: { dark?: boolean; half?: boolean }) {
  const lines = (
    <>
      <span {...stylex.props(styles.bar)} />
      <span {...stylex.props(styles.bar, styles.barShort)} />
    </>
  );
  if (half)
    return (
      <span aria-hidden="true" {...stylex.props(styles.half)}>
        <span {...stylex.props(lightTheme, styles.halfSide)}>{lines}</span>
        <span {...stylex.props(darkTheme, styles.halfSide)}>{lines}</span>
      </span>
    );
  return (
    <span aria-hidden="true" {...stylex.props(dark ? darkTheme : lightTheme, styles.mini)}>
      {lines}
      <span {...stylex.props(styles.dot)} />
    </span>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const LAYOUTS = [
  { value: "stacked", label: "Stacked" },
  { value: "split", label: "Side by side" },
] as const;

// ponytail: theme, layout and the window are this browser profile's (lib/prefs, mirrored to settings.json by the
// desktop app); each choice is a small picture of what it gives
export function AppearanceSection() {
  const [theme, setTheme] = useTheme();
  const [layout, setLayout] = usePref("stepLayout");
  const [onTop] = usePref("alwaysOnTop");
  return (
    <Section
      id="appearance"
      title="Appearance"
      intro="How Testimus looks on this PC. Widths and panes you resize are remembered too."
    >
      <Group title="Look">
        <Row>
          <Field aside label="Theme" hint="System follows Windows, day and night.">
            <div role="radiogroup" aria-label="Theme" {...stylex.props(styles.tiles)}>
              {THEMES.map((t) => (
                <div key={t.value} {...stylex.props(styles.tile)}>
                  <Card
                    density="tight"
                    title={t.label}
                    radio={{
                      name: "theme",
                      value: t.value,
                      checked: theme === t.value,
                      onSelect: () => setTheme(t.value),
                    }}
                  >
                    <Page dark={t.value === "dark"} half={t.value === "system"} />
                  </Card>
                </div>
              ))}
            </div>
          </Field>
        </Row>
        <Row>
          <Field
            aside
            label="Steps in the editor"
            hint="Side by side reads like the Xray table; stacked fits a narrow window."
          >
            <div role="radiogroup" aria-label="Step layout" {...stylex.props(styles.tiles)}>
              {LAYOUTS.map((l) => (
                <div key={l.value} {...stylex.props(styles.tile)}>
                  <Card
                    density="tight"
                    title={l.label}
                    radio={{
                      name: "stepLayout",
                      value: l.value,
                      checked: layout === l.value,
                      onSelect: () => setLayout(l.value),
                    }}
                  >
                    <span aria-hidden="true" {...stylex.props(styles.steps, l.value === "split" && styles.stepsSide)}>
                      <span {...stylex.props(styles.step)} />
                      <span {...stylex.props(styles.step)} />
                    </span>
                  </Card>
                </div>
              ))}
            </div>
          </Field>
        </Row>
      </Group>
      {desktop() && (
        <Group
          title={
            <>
              Window <Badge label="Desktop app" icon="monitor" size="sm" />
            </>
          }
        >
          <Row>
            <Field
              aside
              label="On top"
              hint="Keeps Testimus above Jira while you work beside it. Also from the pin in the Claude dock."
            >
              <div>
                <Switch label="Always on top" on={onTop} onChange={(on) => void setAlwaysOnTop(on)} />
              </div>
            </Field>
          </Row>
          <Row>
            <Fact label="Zoom" hint="The whole window, text and all.">
              <span {...stylex.props(type.small, styles.keys)}>
                <Kbd>Ctrl =</Kbd> larger, <Kbd>Ctrl −</Kbd> smaller, <Kbd>Ctrl 0</Kbd> back to 100 %
              </span>
            </Fact>
          </Row>
        </Group>
      )}
    </Section>
  );
}
