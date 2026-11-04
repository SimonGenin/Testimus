import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Logo } from "../../components/ui/Logo.tsx";
import { Tabs } from "../../components/ui/Tabs.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { AccessStep } from "./AccessStep.tsx";
import { PackStep } from "./PackStep.tsx";
import { ProjectStep } from "./ProjectStep.tsx";

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

type Step = "access" | "project" | "pack";

const ARG: Record<Step, string | undefined> = { access: undefined, project: "project", pack: "pack" };

// ponytail: the first launch — no rail, no dock; three steps a person can walk back and forth, each its own card
export function FirstRunScreen() {
  const app = useApp();
  const step: Step = app.route.arg === "pack" ? "pack" : app.route.arg === "project" ? "project" : "access";
  const go = (s: Step) => app.navigate("setup", ARG[s]);
  return (
    <div {...stylex.props(styles.page)}>
      <div {...stylex.props(styles.col)}>
        <div {...stylex.props(styles.top)}>
          <span {...stylex.props(type.title, styles.brand)}>
            <Logo />
            Testimus
          </span>
          {app.info && (
            <Button
              variant="quiet"
              size="sm"
              icon="chevron-left"
              label="Back to the app"
              onClick={() => app.navigate("tests")}
            />
          )}
        </div>
        <Tabs<Step>
          label="Setup steps"
          variant="steps"
          value={step}
          onChange={go}
          tabs={[
            { value: "access", label: "Access" },
            { value: "project", label: "Project" },
            { value: "pack", label: "Search pack" },
          ]}
        />
        {step === "access" ? (
          <AccessStep onContinue={() => go("project")} onSkip={() => go("project")} />
        ) : step === "project" ? (
          <ProjectStep onBack={() => go("access")} onOpened={() => go("pack")} />
        ) : (
          <PackStep onBack={() => go("project")} />
        )}
      </div>
    </div>
  );
}
