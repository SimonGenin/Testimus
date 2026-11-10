import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { DockDefaults } from "./DockDefaults.tsx";
import { OverviewSetting } from "./OverviewSetting.tsx";
import { useInfo } from "./project.ts";
import { QuickAsks } from "./QuickAsks.tsx";
import { Section } from "./Section.tsx";

const styles = stylex.create({
  aside: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s2, margin: 0, color: color.textSubtle },
});

// ponytail: what this project asks of Claude (project.json claude) — the dock's model and effort, the quick asks, the
// overview of the documents; the program and the runs at once are this PC's (Settings › Claude Code), what each run
// is given is Settings › Context
export function ClaudeSection() {
  const app = useApp();
  const claude = useInfo().data?.project.claude;
  return (
    <Section
      id="claudeproject"
      title="Claude"
      intro="How this project works with Claude: what the dock starts with, the asks you reuse, and the overview Claude keeps of the documents."
      actions={<Button size="sm" label="What each run is given" onClick={() => app.navigate("settings", "context")} />}
    >
      {!claude ? (
        <>
          <Skeleton kind="block" />
          <Loading read="project.info" />
        </>
      ) : (
        <>
          <DockDefaults claude={claude} />
          <QuickAsks presets={claude.presets ?? []} />
          <OverviewSetting overview={claude.overview} />
        </>
      )}
      <p {...stylex.props(type.small, styles.aside)}>
        Which Claude program runs, and how many at once, is set for this PC in
        <Button variant="link" label="Claude Code" onClick={() => app.navigate("settings", "claude")} />
      </p>
    </Section>
  );
}
