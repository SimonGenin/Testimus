import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import {
  border,
  color,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { TestEditor } from "../tests/TestEditor.tsx";

const styles = stylex.create({
  bar: {
    boxSizing: "border-box",
    flex: "none",
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    minHeight: size.topbar,
    paddingBlock: space.s2,
    paddingInline: space.s5,
    borderBottomWidth: border.width,
    borderBottomStyle: "solid",
    borderBottomColor: color.border,
    backgroundColor: color.surface,
  },
  key: { fontFamily: fontFamily.mono, fontSize: fontSize.code, lineHeight: lineHeight.code },
  word: {
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    fontWeight: fontWeight.medium,
    color: color.textMuted,
  },
  grow: { flex: 1 },
  editor: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
});

// ponytail: Review › Edit — the test editor itself, in the column of the test, and the way back to the review
export function ReviewEdit({
  id,
  testKey,
  onAsk,
  onBack,
  onOpen,
}: {
  id: string;
  testKey?: string;
  onAsk: () => void;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <>
      <div role="toolbar" aria-label="Editing in Review" {...stylex.props(styles.bar)}>
        <span {...stylex.props(styles.key)}>{testKey ?? "Not in Jira yet"}</span>
        <span {...stylex.props(styles.word)}>Editing</span>
        <span {...stylex.props(styles.grow)} />
        <Button size="sm" variant="claude-quiet" icon="claude" label="Ask Claude" onClick={onAsk} />
        <Button size="sm" variant="primary" icon="check" label="Back to review" onClick={onBack} />
      </div>
      <div {...stylex.props(styles.editor)}>
        <TestEditor key={id} testId={id} onOpen={onOpen} onSaved={() => {}} />
      </div>
    </>
  );
}
