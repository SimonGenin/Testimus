import { Confirm } from "../../components/legacy/index.ts";
import { plural } from "../../lib/format.ts";

export function ReplaceTests({
  count,
  onReview,
  onConfirm,
  onClose,
}: {
  count: number;
  onReview: () => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Confirm
      title="Replace the tests not validated yet?"
      confirm="Delete and generate"
      danger
      loss={
        <>
          <strong>What is lost: </strong>
          {count === 1
            ? "this test and its screenshots, for good — it was never pushed to Jira."
            : `these ${count} tests and their screenshots, for good — they were never pushed to Jira.`}
        </>
      }
      onClose={onClose}
      onConfirm={onConfirm}
    >
      <p>
        To generate, Testimus first deletes the {plural(count, "test")} Claude wrote that {count === 1 ? "is" : "are"}{" "}
        not validated yet (draft, checked or to fix). Validated tests and tests already in Jira are kept.
      </p>
      <p className="muted">
        To keep one, validate it first in{" "}
        <button type="button" className="linkbtn" onClick={onReview}>
          Review
        </button>
        .
      </p>
    </Confirm>
  );
}
