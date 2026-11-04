import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import type { DocJson } from "../../../core/types.ts";
import { ReviewBadge } from "../../components/ui/Badge.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { ApiError } from "../../lib/data/client.ts";
import { execute, type Prefix, useRead } from "../../lib/data/query.ts";
import { baseName } from "../../lib/desktop.ts";
import { message, plural } from "../../lib/format.ts";
import { toast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s3 },
  muted: { margin: 0, color: color.textMuted },
  note: { margin: 0, color: color.textMuted },
  list: { display: "flex", flexDirection: "column", gap: space.s2, margin: 0, padding: 0, listStyle: "none" },
  test: { display: "flex", alignItems: "center", gap: space.s3 },
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

  // ponytail: a failed delete keeps the dialog open with its reason (the Modal shows what the promise rejects with)
  const remove = async () => {
    const r = await execute(client, "docs.remove", { id: doc.id }, { invalidates: GONE }).catch((e: unknown) => {
      throw new Error(e instanceof ApiError && e.fix ? `${e.message} — ${e.fix}` : message(e));
    });
    const n = r.citedBy.length;
    toast({
      tone: "neutral",
      title: `${doc.code} deleted`,
      detail: n
        ? `${plural(n, "test")} citing it ${n === 1 ? "was" : "were"} re-checked: ${n === 1 ? "its" : "their"} sources now report the missing document.`
        : undefined,
    });
    onRemoved();
  };

  const cited = plan.data?.citedBy ?? [];
  const validated = cited.filter((t) => t.review === "validated").length;
  const unlinked = plan.data?.unlinked ?? [];
  const source = baseName(doc.source.name || doc.source.file) || "the original";
  const figures = doc.converted?.stats?.figures ?? 0;
  const passages = plan.data?.passages ?? 0;
  const consequences: [number, string][] = plan.data
    ? [
        [1, `folder deleted: the copy of ${source}, doc.md, ${plural(figures, "figure")} and its Claude context`],
        [passages, `passage${passages === 1 ? "" : "s"} removed from the index, in every vector space`],
        ...(cited.length
          ? [
              [
                cited.length,
                `test${cited.length === 1 ? " cites" : "s cite"} it${validated ? `, ${validated} of them validated` : ""}: they stay as they are; the check will report their sources as missing`,
              ] as [number, string],
            ]
          : []),
      ]
    : [];
  return (
    <Modal
      title="Delete this document?"
      subtitle={
        <>
          <span {...stylex.props(type.code)}>{doc.code}</span> · {doc.title} · {doc.version}
        </>
      }
      size="sm"
      confirm={{
        verb: "Delete",
        danger: true,
        onConfirm: remove,
        disabled: plan.isPending ? "Looking for the tests that cite it…" : false,
      }}
      consequences={consequences}
      consequencesAt="start"
      onClose={onClose}
    >
      <div {...stylex.props(styles.body)}>
        {plan.isError ? (
          <p {...stylex.props(type.small, styles.muted)}>
            It leaves the project folder and the index. The tests that cite it could not be listed:{" "}
            {message(plan.error)}
          </p>
        ) : plan.isPending ? (
          <div role="status" aria-busy="true" aria-label="Looking for the tests that cite it">
            <Skeleton width="70%" />
          </div>
        ) : !cited.length ? (
          <p {...stylex.props(type.small, styles.muted)}>No test cites it.</p>
        ) : (
          <>
            <ul aria-label="Tests that cite this document" {...stylex.props(styles.list)}>
              {cited.slice(0, SHOWN).map((t) => (
                <li key={t.id} {...stylex.props(type.small, styles.test)}>
                  <span {...stylex.props(type.code)}>{t.key ?? t.id}</span>
                  <span {...stylex.props(styles.sum)}>{t.summary}</span>
                  <ReviewBadge state={t.review} size="sm" />
                </li>
              ))}
            </ul>
            {cited.length > SHOWN && <p {...stylex.props(type.small, styles.muted)}>and {cited.length - SHOWN} more</p>}
          </>
        )}
        {unlinked.length > 0 && (
          <p {...stylex.props(type.small, styles.muted)}>
            {unlinked.length === 1 ? "This document amends it" : "These documents amend it"} and will no longer name it:{" "}
            <span {...stylex.props(type.code)}>{unlinked.join(", ")}</span>
          </p>
        )}
        <p {...stylex.props(type.compact, styles.note)}>
          This cannot be undone: to get it back, add {source} again (status and context start over).
        </p>
      </div>
    </Modal>
  );
}
