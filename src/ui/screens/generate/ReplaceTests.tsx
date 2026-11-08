import * as stylex from "@stylexjs/stylex";
import type { LocalTestRef } from "../../../core/types.ts";
import { Badge, ReviewBadge } from "../../components/ui/Badge.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { List } from "../../components/ui/List.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  p: { margin: 0, color: color.text },
  note: { margin: 0, color: color.textMuted },
  rows: { maxHeight: "40vh", overflowY: "auto" },
});

// ponytail: what « discard » deletes, test by test, as the review queue names them — a test the list does not know
// (yet) shows its id
export function ReplaceTests({
  ids,
  onReview,
  onConfirm,
  onClose,
}: {
  ids: string[];
  onReview: (id: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const listed = useRead("tests.list", {});
  const known = new Map(((listed.data ?? []) as LocalTestRef[]).map((t) => [t.id, t]));
  const tests = ids.map(
    (id) => known.get(id) ?? { id, summary: id, review: "draft" as const, stepCount: 0, edited: false },
  );
  const edited = tests.filter((t) => t.edited).length;
  const count = ids.length;
  const one = count === 1;
  return (
    <Modal
      size="md"
      title={one ? "Delete 1 test before generating?" : `Delete ${count} tests before generating?`}
      confirm={{ verb: "Delete and generate", danger: true, onConfirm }}
      onClose={onClose}
    >
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(type.body, styles.p)}>
          A new generation replaces the {one ? "test" : "tests"} Claude wrote that you have not validated yet.{" "}
          {one ? "This test is" : "These tests are"} deleted for good, with {one ? "its" : "their"} screenshots:
        </p>
        <Card padded={false} sunken>
          <div {...stylex.props(styles.rows)}>
            <List
              label="Tests to delete"
              items={tests}
              getKey={(t) => t.id}
              loading={listed.isPending ? Math.min(count, 3) : false}
              reading="tests.list"
              density="two-line"
              onSelect={onReview}
              renderItem={(t) => ({
                title: t.summary,
                tooltip: `${t.summary} — open it in Review`,
                meta: (
                  <span {...stylex.props(type.code)}>
                    {t.id}
                    {t.stepCount > 0 && ` · ${plural(t.stepCount, "step")}`}
                  </span>
                ),
                badges: t.edited && <Badge label="Edited by you" tone="warning" icon="circle-dot" size="sm" />,
                trail: <ReviewBadge state={t.review} size="sm" />,
              })}
            />
          </div>
        </Card>
        {edited > 0 && (
          <p {...stylex.props(type.body, styles.p)}>
            {one
              ? "You edited this test since Claude wrote it: your changes are lost too."
              : edited === count
                ? "You edited these tests since Claude wrote them: your changes are lost too."
                : `You edited ${edited} of them since Claude wrote them: those changes are lost too.`}
          </p>
        )}
        <p {...stylex.props(type.small, styles.note)}>
          Kept: validated tests and every test already in Jira. To keep one of these, open it and validate it in Review
          first.
        </p>
      </div>
    </Modal>
  );
}
