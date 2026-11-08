import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { space } from "../../styles/tokens.stylex.ts";
import { marksLine, type RunResult } from "./runs.ts";

const styles = stylex.create({
  dots: { display: "inline-flex", alignItems: "center", gap: space.s1, flex: "none" },
});

// ponytail: one dot per step — OK green, NOK red, not marked grey — the marks read at a glance; the words say it too
export function StepDots({ steps }: { steps: RunResult["steps"] }) {
  return (
    <span role="img" aria-label={marksLine({ steps })} {...stylex.props(styles.dots)}>
      {steps.map((s, i) => (
        <Badge
          key={i}
          dot
          tone={s.ok === true ? "success" : s.ok === false ? "danger" : "neutral"}
          label={`Step ${i + 1}: ${s.ok === true ? "OK" : s.ok === false ? "NOK" : "not marked"}`}
        />
      ))}
    </span>
  );
}
