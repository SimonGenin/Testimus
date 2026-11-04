import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { desktop, setAlwaysOnTop } from "../../lib/desktop.ts";
import { usePref } from "../../lib/prefs.ts";
import { setThemeEverywhere, type Theme } from "../../lib/theme.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { useSetting, useSettings } from "./machine.ts";
import { Grid, Hint, Section, Stack } from "./Section.tsx";

const styles = stylex.create({
  field: { display: "flex", flexDirection: "column", gap: space.s2 },
  kept: { display: "flex", alignItems: "center", gap: space.s2 },
});

// ponytail: theme, layout and the window are this browser profile's (lib/prefs, mirrored to settings.json by the
// desktop app); model downloads are this PC's setting (system.set)
export function AppearanceSection() {
  const [theme, setTheme] = usePref("theme");
  const [layout, setLayout] = usePref("stepLayout");
  const [onTop, setOnTop] = usePref("alwaysOnTop");
  const settings = useSettings();
  const setting = useSetting();
  return (
    <Section id="appearance" title="Appearance" intro="How Testimus looks and behaves on this PC.">
      <Card title="Appearance">
        <Stack>
          <Grid>
            <div {...stylex.props(styles.field)}>
              <Segmented<Theme>
                label="Theme"
                value={theme as Theme}
                onChange={(t) => {
                  setTheme(t);
                  setThemeEverywhere(t);
                }}
                options={[
                  { value: "system", label: "System", icon: "monitor" },
                  { value: "light", label: "Light", icon: "sun" },
                  { value: "dark", label: "Dark", icon: "moon" },
                ]}
              />
              <Hint>Also from the rail, at the bottom.</Hint>
            </div>
            <Segmented
              label="Step layout"
              value={layout}
              onChange={setLayout}
              options={[
                { value: "stacked", label: "Stacked", icon: "layout-stacked" },
                { value: "split", label: "Action | Expected", icon: "layout-split" },
              ]}
            />
          </Grid>
          <span {...stylex.props(styles.kept)}>
            <Icon name="history" size="sm" />
            <Hint>Theme, layout, widths and recent tests are kept on this PC across restarts.</Hint>
          </span>
        </Stack>
      </Card>
      {desktop() && (
        <Card
          title={
            <>
              Window <Badge label="Desktop app" icon="monitor" size="sm" />
            </>
          }
        >
          <Stack>
            <Switch
              label="Always on top"
              on={onTop}
              onChange={(on) => {
                void setAlwaysOnTop(on);
                setOnTop(on);
              }}
            />
            <Hint>
              Keeps Testimus above Jira while you work beside it. Also from the pin in the Claude dock. Zoom with Ctrl+=
              · Ctrl+− · Ctrl+0.
            </Hint>
          </Stack>
        </Card>
      )}
      <Card title="Model downloads">
        <Stack>
          <Switch
            label="Allow downloads from Hugging Face"
            on={settings.data?.models.allowRemote ?? true}
            disabled={!settings.data}
            onChange={(allowRemote) => void setting({ allowRemote })}
          />
          <Hint>Turn it off behind a proxy that blocks them: add models from a folder instead (Models).</Hint>
        </Stack>
      </Card>
    </Section>
  );
}
