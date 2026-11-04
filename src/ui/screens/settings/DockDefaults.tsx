import * as stylex from "@stylexjs/stylex";
import { cap, EFFORTS, ModelPicker } from "../../components/claude/ModelPicker.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { type ProjectJson, useSetProject } from "./project.ts";
import { Grid, Hint, Stack } from "./Section.tsx";

const styles = stylex.create({
  field: { display: "flex", flexDirection: "column", gap: space.s2 },
  label: { fontSize: fontSize.compact, lineHeight: lineHeight.compact, fontWeight: fontWeight.medium },
});

type Effort = ProjectJson["claude"]["effort"];

export function DockDefaults({ claude }: { claude: ProjectJson["claude"] }) {
  const setProject = useSetProject();
  return (
    <Card title="Claude dock">
      <Stack>
        <Grid>
          <div {...stylex.props(styles.field)}>
            <label htmlFor="set-model" {...stylex.props(styles.label)}>
              Default model
            </label>
            <ModelPicker
              id="set-model"
              className=""
              value={claude.model}
              onChange={(model) => void setProject({ claude: { model } }, "the model")}
            />
            <Hint>fable · opus · sonnet · haiku, or custom… for a typed alias.</Hint>
          </div>
          <div {...stylex.props(styles.field)}>
            <Select<Effort>
              label="Default effort"
              showLabel
              value={claude.effort}
              options={EFFORTS.map((e) => ({ value: e, label: cap(e) }))}
              onChange={(effort) => void setProject({ claude: { effort } }, "the effort")}
            />
            <Hint>low … max.</Hint>
          </div>
        </Grid>
        <Hint>Pre-selected in the Claude dock; each run can still change them.</Hint>
      </Stack>
    </Card>
  );
}
