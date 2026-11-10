import * as stylex from "@stylexjs/stylex";
import { NoProject } from "../../components/shell/NoProject.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { useApp } from "../../lib/app.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import { AgentsField } from "./AgentsField.tsx";
import { ClaudeProgram } from "./ClaudeProgram.tsx";
import { DockDefaults } from "./DockDefaults.tsx";
import { OverviewSetting } from "./OverviewSetting.tsx";
import { useInfo } from "./project.ts";
import { QuickAsks } from "./QuickAsks.tsx";
import { Anchor, Column, Columns, Section } from "./Section.tsx";

const styles = stylex.create({
  split: {
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
  },
  rule: {
    boxSizing: "border-box",
    height: 0,
    margin: 0,
    borderWidth: 0,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
});

// ponytail: the connection is this PC's and works without a project; the dock defaults and quick asks are the
// project's (project.json). The default contexts are in Settings › Context, with everything Claude is given
export function ClaudeSection() {
  const app = useApp();
  const info = useInfo();
  const claude = app.info ? info.data?.project.claude : undefined;
  return (
    <Section
      id="claude"
      title="Claude"
      intro="Claude writes and checks tests through Claude Code on this PC, with your own Claude account."
    >
      <Columns>
        <Column>
          <Anchor id="claude">
            <Card title="Connection to Claude">
              <div {...stylex.props(styles.split)}>
                <ClaudeProgram />
                <hr {...stylex.props(styles.rule)} />
                <AgentsField />
              </div>
            </Card>
          </Anchor>
          {claude && (
            <Anchor id="claude-dock">
              <DockDefaults claude={claude} />
            </Anchor>
          )}
        </Column>
        {!app.info && (
          <Column>
            <Card padded={false}>
              <NoProject text="The Claude dock and the quick asks are a project's: open one to set them." />
            </Card>
          </Column>
        )}
        {claude && (
          <Column>
            <Anchor id="claude-quickasks">
              <QuickAsks presets={claude.presets ?? []} />
            </Anchor>
            <Anchor id="claude-overview">
              <OverviewSetting overview={claude.overview} />
            </Anchor>
          </Column>
        )}
      </Columns>
    </Section>
  );
}
