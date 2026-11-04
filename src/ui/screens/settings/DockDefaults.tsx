import { cap, EFFORTS, ModelPicker } from "../../components/claude/ModelPicker.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { type ProjectJson, useSetProject } from "./project.ts";
import { Grid, Hint, Labelled, Stack } from "./Section.tsx";

type Effort = ProjectJson["claude"]["effort"];

export function DockDefaults({ claude }: { claude: ProjectJson["claude"] }) {
  const setProject = useSetProject();
  return (
    <Card title="Claude dock">
      <Stack>
        <Grid>
          <Labelled
            id="set-model"
            label="Default model"
            hint="fable · opus · sonnet · haiku, or custom… for a typed alias."
          >
            <ModelPicker
              id="set-model"
              className=""
              value={claude.model}
              onChange={(model) => void setProject({ claude: { model } }, "the model")}
            />
          </Labelled>
          <Labelled id="set-effort" label="Default effort" hint="low … max.">
            <Select<Effort>
              id="set-effort"
              label="Default effort"
              block
              value={claude.effort}
              options={EFFORTS.map((e) => ({ value: e, label: cap(e) }))}
              onChange={(effort) => void setProject({ claude: { effort } }, "the effort")}
            />
          </Labelled>
        </Grid>
        <Hint>Pre-selected in the Claude dock; each run can still change them.</Hint>
      </Stack>
    </Card>
  );
}
