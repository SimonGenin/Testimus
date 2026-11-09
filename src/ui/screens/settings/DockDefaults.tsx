import { cap, EFFORTS, ModelPicker } from "../../components/claude/ModelPicker.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { type ProjectJson, useSetProject } from "./project.ts";
import { Grid, Hint, Stack } from "./Section.tsx";

type Effort = ProjectJson["claude"]["effort"];

export function DockDefaults({ claude }: { claude: ProjectJson["claude"] }) {
  const setProject = useSetProject();
  return (
    <Card title="Claude dock">
      <Stack>
        <Grid>
          <Field htmlFor="set-model" label="Default model" hint="fable · opus · sonnet · haiku.">
            <ModelPicker
              id="set-model"
              size="md"
              appearance="boxed"
              block
              value={claude.model}
              onChange={(model) => void setProject({ claude: { model } }, "the model")}
            />
          </Field>
          <Select<Effort>
            id="set-effort"
            label="Default effort"
            showLabel
            hint="low … max."
            block
            value={claude.effort}
            options={EFFORTS.map((e) => ({ value: e, label: cap(e) }))}
            onChange={(effort) => void setProject({ claude: { effort } }, "the effort")}
          />
        </Grid>
        <Hint>Pre-selected in the Claude dock; each run can still change them.</Hint>
      </Stack>
    </Card>
  );
}
