import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { useApp } from "../../lib/app.ts";
import { OVERVIEW_ROUTE, OVERVIEW_TITLE } from "../../lib/overview.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { type ProjectJson, useSetProject } from "./project.ts";
import { Hint } from "./Section.tsx";

const styles = stylex.create({
  stack: { display: "flex", flexDirection: "column", gap: space.s4 },
});

// ponytail: project.json claude.overview — Claude writes docs/OVERVIEW.md and keeps it up to date after each import,
// and every run is told to read it; both off until the team turns them on
export function OverviewSetting({ overview }: { overview: ProjectJson["claude"]["overview"] }) {
  const app = useApp();
  const setProject = useSetProject();
  const enabled = !!overview?.enabled;
  const inEveryRun = enabled && !!overview?.inEveryRun;
  const set = (next: { enabled: boolean; inEveryRun: boolean }) =>
    void setProject({ claude: { overview: next } }, "how the documents fit together");
  return (
    <Card
      title={OVERVIEW_TITLE}
      actions={
        <Button size="sm" variant="quiet" label="Open it" onClick={() => app.navigate("documents", OVERVIEW_ROUTE)} />
      }
    >
      <div {...stylex.props(styles.stack)}>
        <Switch
          on={enabled}
          label="Claude writes it and updates it after each import"
          hint="docs/OVERVIEW.md: what each document is and how they link, amend or contradict each other. Only what an import changes is updated."
          onChange={(on) => set({ enabled: on, inEveryRun: on && (overview?.inEveryRun ?? true) })}
        />
        <Switch
          on={inEveryRun}
          label="Give it to every Claude run"
          hint="Each run is told to read it first, as it reads the project's contexts."
          disabled={enabled ? false : "Turn it on first"}
          onChange={(on) => set({ enabled, inEveryRun: on })}
        />
        <Hint>Off, the file is neither written nor given to a run; what is in it stays.</Hint>
      </div>
    </Card>
  );
}
