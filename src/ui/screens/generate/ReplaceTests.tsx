import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { color } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  p: { margin: 0, color: color.text },
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
          `${count === 1 ? "test" : "tests"} deleted for good with ${count === 1 ? "its" : "their"} screenshots: ${ids.join(", ")} — never pushed to Jira`,
        ],
      ]}
      onClose={onClose}
    >
      <p {...stylex.props(type.body, styles.p)}>
        To generate, Testimus first deletes the {plural(count, "test")} Claude wrote that {count === 1 ? "is" : "are"}{" "}
        not validated yet (draft or to fix). Validated tests and tests already in Jira are kept. To keep one,{" "}
        <Button variant="link" label="validate it in Review first" onClick={onReview} />.
      </p>
    </Modal>
  );
}
