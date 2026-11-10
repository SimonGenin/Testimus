import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { type } from "../../components/ui/type.ts";
import { type Theme, useTheme } from "../../lib/theme.ts";
import { breakpoint, color, space } from "../../styles/tokens.stylex.ts";
import { useSetting, useSettings } from "../settings/machine.ts";
import { StepCard } from "./StepCard.tsx";

const styles = stylex.create({
  how: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "grid",
    gridTemplateColumns: { default: "repeat(4, minmax(0, 1fr))", [breakpoint.narrow]: "repeat(2, minmax(0, 1fr))" },
    gap: space.s3,
  },
  stage: { display: "flex", flexDirection: "column", gap: space.s1 },
  num: { color: color.textSubtle },
  muted: { color: color.textMuted },
  set: { display: "flex", flexDirection: "column", gap: space.s3 },
  title: { margin: 0, color: color.text },
  hint: { color: color.textSubtle },
});

export type Mode = "jira" | "local" | "join";

const STAGES = [
  { title: "Add documents", text: ".docx or .pdf, indexed on this PC" },
  { title: "Generate", text: "Claude writes tests with sources" },
  { title: "Review", text: "Validate, or send back to fix" },
  { title: "Push to Xray", text: "A plan first, then the push" },
];

const MODES: { value: Mode; title: string; text: string }[] = [
  {
    value: "jira",
    title: "With Jira and Xray",
    text: "Read the tests already in Xray, push the new ones. Needs a Jira API token; an Xray key to write steps.",
  },
  {
    value: "local",
    title: "On this PC only, for now",
    text: "Tests stay here as files. Jira is left out, never reported as a problem; connect it later in Settings › Jira and Xray.",
  },
  {
    value: "join",
    title: "Join a colleague's project",
    text: "Open a project folder someone shared with you. Its settings and step columns come with it.",
  },
];

// ponytail: the first step — what Testimus does, how the person will work (Jira or not: the system check then says
// « not used » instead of failing), and the theme; a colleague's project goes straight to the Project step
export function WelcomeStep({ onStart }: { onStart: (join: boolean) => void }) {
  const settings = useSettings();
  const setting = useSetting();
  const [theme, setTheme] = useTheme();
  const [picked, setPicked] = useState<Mode | null>(null);
  const mode: Mode = picked ?? (settings.data?.atlassian?.skipJira ? "local" : "jira");
  const start = async () => {
    const skipJira = mode === "local";
    if (mode !== "join" && skipJira !== !!settings.data?.atlassian?.skipJira) await setting({ skipJira });
    onStart(mode === "join");
  };
  return (
    <StepCard
      id="welcome-h"
      title="Welcome to Testimus"
      lead="Testimus turns your specifications into manual tests. Claude writes them, every expected result with its source in the document; you review them, then push them to Xray."
      actions={
        <>
          <span {...stylex.props(type.small, styles.hint)}>Every answer can be changed later.</span>
          <Button variant="primary" size="lg" iconAfter="chevron-right" label="Start" onClick={() => void start()} />
        </>
      }
    >
      <ol aria-label="How it works" {...stylex.props(styles.how)}>
        {STAGES.map((s, i) => (
          <li key={s.title}>
            <Card density="compact" sunken fill>
              <span {...stylex.props(styles.stage)}>
                <span {...stylex.props(type.small, type.tabular, styles.num)}>{i + 1}</span>
                <span {...stylex.props(type.compact, type.strong)}>{s.title}</span>
                <span {...stylex.props(type.small, styles.muted)}>{s.text}</span>
              </span>
            </Card>
          </li>
        ))}
      </ol>
      <section aria-labelledby="mode-h" {...stylex.props(styles.set)}>
        <h2 id="mode-h" {...stylex.props(type.titleSm, styles.title)}>
          How will you work?
        </h2>
        <div role="radiogroup" aria-labelledby="mode-h" {...stylex.props(styles.set)}>
          {MODES.map((m) => (
            <Card
              key={m.value}
              density="compact"
              title={m.title}
              radio={{ name: "mode", value: m.value, checked: mode === m.value, onSelect: (v) => setPicked(v as Mode) }}
            >
              <span {...stylex.props(type.compact, styles.muted)}>{m.text}</span>
            </Card>
          ))}
        </div>
      </section>
      <Field label="Theme">
        <Segmented<Theme>
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "System", icon: "monitor" },
            { value: "light", label: "Light", icon: "sun" },
            { value: "dark", label: "Dark", icon: "moon" },
          ]}
        />
      </Field>
    </StepCard>
  );
}
