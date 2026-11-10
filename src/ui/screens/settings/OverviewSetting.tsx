import { Button } from "../../components/ui/Button.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { useApp } from "../../lib/app.ts";
import { OVERVIEW_ROUTE, OVERVIEW_TITLE } from "../../lib/overview.ts";
import { type ProjectJson, useSetProject } from "./project.ts";
import { Group, Hint, Row } from "./Section.tsx";

// ponytail: project.json claude.overview — Claude writes docs/OVERVIEW.md and keeps it up to date after each import,
// and every run is told to read it; both off until turned on
export function OverviewSetting({ overview }: { overview: ProjectJson["claude"]["overview"] }) {
  const app = useApp();
  const setProject = useSetProject();
  const enabled = !!overview?.enabled;
  const inEveryRun = enabled && !!overview?.inEveryRun;
  const set = (next: { enabled: boolean; inEveryRun: boolean }) =>
    void setProject({ claude: { overview: next } }, "how the documents fit together");
  return (
    <Group
      id="claudeproject-overview"
      title={OVERVIEW_TITLE}
      actions={
        <Button size="sm" variant="quiet" label="Open it" onClick={() => app.navigate("documents", OVERVIEW_ROUTE)} />
      }
      footer={<Hint>Off, the file is neither written nor given to a run; what it holds stays.</Hint>}
    >
      <Row>
        <Field
          aside
          label="Overview"
          hint="docs/OVERVIEW.md: what each document is and how they link, amend or contradict each other."
        >
          <div>
            <Switch
              on={enabled}
              label="Claude writes it and updates it after each import"
              onChange={(on) => set({ enabled: on, inEveryRun: on && (overview?.inEveryRun ?? true) })}
            />
          </div>
        </Field>
      </Row>
      <Row>
        <Field aside label="In every run" hint="Read first, as the project's contexts are.">
          <div>
            <Switch
              on={inEveryRun}
              label="Give it to every Claude run"
              disabled={enabled ? false : "Turn it on first"}
              onChange={(on) => set({ enabled, inEveryRun: on })}
            />
          </div>
        </Field>
      </Row>
    </Group>
  );
}
