import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Logo } from "../../components/ui/Logo.tsx";
import { Tabs } from "../../components/ui/Tabs.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { useSettings } from "../settings/machine.ts";
import { AccessStep } from "./AccessStep.tsx";
import { ClaudeStep } from "./ClaudeStep.tsx";
import { PackStep } from "./PackStep.tsx";
import { ProjectStep } from "./ProjectStep.tsx";
import { ReadyStep } from "./ReadyStep.tsx";
import { WelcomeStep } from "./WelcomeStep.tsx";

const styles = stylex.create({
  page: { flex: 1, minHeight: 0, overflowY: "auto", backgroundColor: color.canvas },
  col: {
    boxSizing: "border-box",
    maxWidth: `calc(${size.reading} + ${space.s8})`,
    marginInline: "auto",
    paddingBlockStart: space.s9,
    paddingBlockEnd: space.s10,
    paddingInline: space.s7,
    display: "flex",
    flexDirection: "column",
    gap: space.s6,
  },
  top: { display: "flex", alignItems: "center", gap: space.s3 },
  brand: {
    flex: 1,
    display: "inline-flex",
    alignItems: "center",
    gap: space.s4,
    color: color.text,
  },
});

export type Step = "welcome" | "claude" | "access" | "project" | "pack" | "ready";

const ARGS: Step[] = ["claude", "access", "project", "pack", "ready"];

export const stepOf = (arg: string | undefined): Step => ARGS.find((s) => s === arg) ?? "welcome";

const argOf = (s: Step) => (s === "welcome" ? undefined : s);

// ponytail: the first launch — no rail, no dock; five steps a person can walk back and forth, each its own card, then
// what is ready and what was left for later; each step opens at its top (the page is new for each)
export function FirstRunScreen() {
  const app = useApp();
  const step = stepOf(app.route.arg);
  const go = (s: Step) => app.navigate("setup", argOf(s));
  const noJira = !!useSettings().data?.atlassian?.skipJira;
  return (
    <div key={step} {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.col)}>
        <div {...stylex.props(styles.top)}>
          <span {...stylex.props(type.title, styles.brand)}>
            <Logo />
            Testimus
          </span>
          {app.info && step !== "ready" && (
            <Button
              variant="quiet"
              size="sm"
              icon="chevron-left"
              label="Back to the app"
              onClick={() => app.navigate("documents")}
            />
          )}
        </div>
        {step !== "ready" && (
          <Tabs<Step>
            label="Setup steps"
            variant="steps"
            value={step}
            onChange={go}
            tabs={[
              { value: "welcome", label: "Welcome" },
              { value: "claude", label: "Claude" },
              { value: "access", label: "Jira & Xray" },
              { value: "project", label: "Project" },
              { value: "pack", label: "Search" },
            ]}
          />
        )}
        {step === "welcome" ? (
          <WelcomeStep onStart={(join) => go(join ? "project" : "claude")} />
        ) : step === "claude" ? (
          <ClaudeStep onBack={() => go("welcome")} onContinue={() => go(noJira ? "project" : "access")} />
        ) : step === "access" ? (
          <AccessStep onBack={() => go("claude")} onContinue={() => go("project")} />
        ) : step === "project" ? (
          <ProjectStep onBack={() => go(noJira ? "claude" : "access")} onOpened={() => go("pack")} />
        ) : step === "pack" ? (
          <PackStep onBack={() => go("project")} onDone={() => go("ready")} />
        ) : (
          <ReadyStep />
        )}
      </div>
    </div>
  );
}
