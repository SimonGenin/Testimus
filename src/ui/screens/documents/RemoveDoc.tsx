import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import type { DocJson } from "../../../core/types.ts";
import { ReviewBadge } from "../../components/ui/Badge.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { execute, type Prefix, useRead } from "../../lib/data/query.ts";
import { message, plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { color, fontFamily, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s3 },
  p: { margin: 0, fontSize: fontSize.body, lineHeight: lineHeight.body, color: color.text },
  muted: { margin: 0, fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
  mono: { fontFamily: fontFamily.mono, fontSize: fontSize.code },
  list: { display: "flex", flexDirection: "column", gap: space.s2, margin: 0, padding: 0, listStyle: "none" },
  test: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
  },
  sum: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

const SHOWN = 8;

// ponytail: what a delete changes — the list, the index, and the tests that cited it (re-checked by the core)
const GONE: Prefix[] = [
  ["docs.list"],
  ["rag.status"],
  ["tests.list"],
  ["review.queue"],
  ["check.show"],
  ["search.all"],
];

// ponytail: the plan first (docs.remove --dry-run: the tests that cite it, the documents that amend it), then the delete
export function RemoveDoc({ doc, onClose, onRemoved }: { doc: DocJson; onClose: () => void; onRemoved: () => void }) {
  const client = useQueryClient();
  const plan = useRead("docs.remove", { id: doc.id, dryRun: true });

  const remove = async () => {
    try {
      const r = await execute(client, "docs.remove", { id: doc.id }, { invalidates: GONE });
      const n = r.citedBy.length;
      toast({
        kind: "info",
        title: `${doc.code} deleted`,
        detail: n
          ? `${plural(n, "test")} citing it ${n === 1 ? "was" : "were"} re-checked: ${n === 1 ? "its" : "their"} sources now report the missing document.`
          : undefined,
      });
      onRemoved();
    } catch (e) {
      errorToast(e, "Could not delete the document");
      onClose();
    }
  };

  const cited = plan.data?.citedBy ?? [];
  const validated = cited.filter((t) => t.review === "validated").length;
  const unlinked = plan.data?.unlinked ?? [];
  return (
    <Modal
      title="Delete this document?"
      size="sm"
      confirm={{ verb: "Delete", danger: true, onConfirm: remove }}
      busy={plan.isPending}
      onClose={onClose}
    >
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(styles.p)}>
          <span {...stylex.props(styles.mono)}>{doc.code}</span> — {doc.title} — is removed from the project folder and
          from the index.
        </p>
        <p {...stylex.props(styles.muted)}>
          <strong>What is lost: </strong>the copy of the original, the converted text, the figures and their
          descriptions, the context, and its passages in the search index.
        </p>
        {plan.isError ? (
          <p {...stylex.props(styles.muted)}>The tests that cite it could not be listed: {message(plan.error)}</p>
        ) : plan.isPending ? (
          <div role="status" aria-busy="true" aria-label="Looking for the tests that cite it">
            <Skeleton width="70%" />
          </div>
        ) : !cited.length ? (
          <p {...stylex.props(styles.muted)}>No test cites it.</p>
        ) : (
          <>
            <p {...stylex.props(styles.p)}>
              <strong>
                {plural(cited.length, "test")} cite{cited.length === 1 ? "s" : ""} it
              </strong>
              {validated ? `, ${validated} of them validated` : ""}. They keep their sources and their review; the check
              will report each of those sources as a missing document.
            </p>
            <ul aria-label="Tests that cite this document" {...stylex.props(styles.list)}>
              {cited.slice(0, SHOWN).map((t) => (
                <li key={t.id} {...stylex.props(styles.test)}>
                  <span {...stylex.props(styles.mono)}>{t.key ?? t.id}</span>
                  <span {...stylex.props(styles.sum)}>{t.summary}</span>
                  <ReviewBadge state={t.review} size="sm" />
                </li>
              ))}
            </ul>
            {cited.length > SHOWN && <p {...stylex.props(styles.muted)}>and {cited.length - SHOWN} more</p>}
          </>
        )}
        {unlinked.length > 0 && (
          <p {...stylex.props(styles.muted)}>
            {unlinked.length === 1 ? "This document amends it" : "These documents amend it"} and will no longer name it:{" "}
            <span {...stylex.props(styles.mono)}>{unlinked.join(", ")}</span>
          </p>
        )}
      </div>
    </Modal>
  );
}
