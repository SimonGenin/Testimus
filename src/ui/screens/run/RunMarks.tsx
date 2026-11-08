import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  marks: { display: "inline-flex", flex: "none", gap: space.s1, margin: 0, padding: 0, borderWidth: 0, minWidth: 0 },
});

// ponytail: OK / NOK of one step, as big as the step's head allows — a second press takes the mark back
export function RunMarks({
  n,
  ok,
  size = "md",
  onMark,
}: {
  n: number;
  ok: boolean | null;
  size?: "sm" | "md";
  onMark: (ok: boolean | null) => void;
}) {
  return (
    <fieldset aria-label={`Step ${n}`} {...stylex.props(styles.marks)}>
      <Button
        size={size}
        label="OK"
        icon="check"
        tone="success"
        pressed={ok === true}
        onClick={() => onMark(ok === true ? null : true)}
      />
      <Button
        size={size}
        label="NOK"
        icon="close"
        tone="danger"
        pressed={ok === false}
        onClick={() => onMark(ok === false ? null : false)}
      />
    </fieldset>
  );
}
