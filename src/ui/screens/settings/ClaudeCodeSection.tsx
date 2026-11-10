import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { AgentsField } from "./AgentsField.tsx";
import { ClaudeProgram } from "./ClaudeProgram.tsx";
import { Group, Section } from "./Section.tsx";

const styles = stylex.create({
  aside: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2, margin: 0, color: color.textSubtle },
});

// ponytail: this PC's Claude Code, for every project — the program and how many runs at once (settings.json); what a
// project asks of Claude (the dock, the quick asks, the overview) is its own page
export function ClaudeCodeSection() {
  const app = useApp();
  return (
    <Section
      id="claude"
      title="Claude Code"
      intro="The Claude program that writes and checks tests, on this PC, with your own Claude account. It serves every project you open here."
    >
      <Group title="Program">
        <ClaudeProgram />
      </Group>
      <Group title="Runs at once" note="For a generation or a check that starts several agents.">
        <AgentsField />
      </Group>
      <p {...stylex.props(type.small, styles.aside)}>
        The model and effort the dock starts with, and the quick asks, belong to each project:
        <Button
          variant="link"
          label="Settings › Claude"
          disabled={!app.info ? "Open a project first" : false}
          onClick={() => app.navigate("settings", "claudeproject")}
        />
      </p>
    </Section>
  );
}
