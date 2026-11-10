import { cap, EFFORTS, ModelPicker } from "../../components/claude/ModelPicker.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { type ProjectJson, useSetProject } from "./project.ts";
import { Group, Row } from "./Section.tsx";

type Effort = ProjectJson["claude"]["effort"];

export function DockDefaults({ claude }: { claude: ProjectJson["claude"] }) {
  const setProject = useSetProject();
  return (
    <Group id="claudeproject-dock" title="Claude dock" note="What a run starts with; each run can still change it.">
      <Row>
        <Field aside htmlFor="set-model" label="Model" hint="The one picked when the dock opens.">
          <div>
            <ModelPicker
              id="set-model"
              size="md"
              appearance="boxed"
              value={claude.model}
              onChange={(model) => void setProject({ claude: { model } }, "the model")}
            />
          </div>
        </Field>
      </Row>
      <Row>
        <Field aside label="Effort" hint="More effort: a slower run that thinks longer.">
          <div>
            <Segmented<Effort>
              label="Default effort"
              value={claude.effort}
              options={EFFORTS.map((e) => ({ value: e, label: cap(e) }))}
              onChange={(effort) => void setProject({ claude: { effort } }, "the effort")}
            />
          </div>
        </Field>
      </Row>
    </Group>
  );
}
