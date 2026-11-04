import * as stylex from "@stylexjs/stylex";
import { TestEditor } from "../tests/TestEditor.tsx";

const styles = stylex.create({
  editor: { flex: 1, minHeight: 0, display: "flex", flexDirection: "column" },
});

// ponytail: Review › Edit — the test editor itself, in the column of the test; its one bar says « Editing » and leads
// back to the review
export function ReviewEdit({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: (id: string) => void }) {
  return (
    <div {...stylex.props(styles.editor)}>
      <TestEditor key={id} testId={id} onOpen={onOpen} onSaved={() => {}} onBack={onBack} />
    </div>
  );
}
