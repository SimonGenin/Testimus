import * as stylex from "@stylexjs/stylex";
import { color, fontFamily, fontSize, radius, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  code: {
    paddingInline: space.s1,
    borderRadius: radius.r1,
    backgroundColor: color.surfaceSunken,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
  },
});

// ponytail: a diagnosis is written with `commands` in backquotes (src/core/claude/diagnose.ts); they are shown as code,
// never as raw markdown
export function DiagnosisText({ text }: { text: string }) {
  const parts = text.split(/`([^`\n]+)`/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <code key={i} {...stylex.props(styles.code)}>
            {p}
          </code>
        ) : (
          p
        ),
      )}
    </>
  );
}
