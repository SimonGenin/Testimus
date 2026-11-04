import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { plural } from "../../lib/format.ts";
import { color, fontFamily, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s3 },
  p: { margin: 0, fontSize: fontSize.body, lineHeight: lineHeight.body, color: color.text },
  muted: {
    margin: 0,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s1,
    fontSize: fontSize.compact,
    color: color.textMuted,
  },
  ids: { fontFamily: fontFamily.mono, fontSize: fontSize.code, color: color.textMuted },
});

export function ReplaceTests({
  ids,
  onReview,
  onConfirm,
  onClose,
}: {
  ids: string[];
  onReview: () => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const count = ids.length;
  return (
    <Modal
      size="sm"
      title="Replace the tests not validated yet?"
      confirm={{ verb: "Delete and generate", danger: true, onConfirm }}
      consequences={[
        [
          count,
          `${count === 1 ? "test" : "tests"} deleted for good with ${count === 1 ? "its" : "their"} screenshots — never pushed to Jira`,
        ],
      ]}
      onClose={onClose}
    >
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(styles.p)}>
          To generate, Testimus first deletes the {plural(count, "test")} Claude wrote that {count === 1 ? "is" : "are"}{" "}
          not validated yet (draft, checked or to fix). Validated tests and tests already in Jira are kept.
        </p>
        <span {...stylex.props(styles.ids)}>{ids.join(", ")}</span>
        <p {...stylex.props(styles.muted)}>
          To keep one, validate it first in
          <Button size="sm" variant="quiet" label="Review" onClick={onReview} />
        </p>
      </div>
    </Modal>
  );
}
