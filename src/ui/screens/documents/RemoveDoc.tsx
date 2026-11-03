import { useEffect, useState } from "react";
import type { CitingTest, DocJson } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { Confirm, ReviewBadge, Skeleton } from "../../components/ui/index.ts";
import { message, plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";

type Plan = { citedBy: CitingTest[]; unlinked: string[] };

const SHOWN = 8;

export function RemoveDoc({ doc, onClose, onRemoved }: { doc: DocJson; onClose: () => void; onRemoved: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [planError, setPlanError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let dead = false;
    call<Plan>("docs.remove", { id: doc.id, dryRun: true })
      .then((r) => !dead && setPlan(r))
      .catch((e) => !dead && setPlanError(message(e)));
    return () => {
      dead = true;
    };
  }, [doc.id]);

  const remove = async () => {
    setBusy(true);
    try {
      const r = await call<Plan>("docs.remove", { id: doc.id });
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
      setBusy(false);
      onClose();
    }
  };

  const cited = plan?.citedBy ?? [];
  const validated = cited.filter((t) => t.review === "validated").length;
  return (
    <Confirm
      title="Delete this document?"
      confirm="Delete"
      danger
      busy={busy || (!plan && !planError)}
      loss={
        <>
          <strong>What is lost: </strong>the copy of the original, the converted text, the figures and their
          descriptions, the context, and its passages in the search index.
        </>
      }
      onClose={onClose}
      onConfirm={() => void remove()}
    >
      <p>
        <span className="mono">{doc.code}</span> — {doc.title} — is removed from the project folder and from the index.
      </p>
      {planError ? (
        <p className="muted">The tests that cite it could not be listed: {planError}</p>
      ) : !plan ? (
        <div role="status" aria-busy="true" aria-label="Looking for the tests that cite it">
          <Skeleton w="70%" h={13} />
        </div>
      ) : !cited.length ? (
        <p className="muted">No test cites it.</p>
      ) : (
        <div className="doc-cited">
          <p>
            <strong>
              {plural(cited.length, "test")} cite{cited.length === 1 ? "s" : ""} it
            </strong>
            {validated ? `, ${validated} of them validated` : ""}. They keep their sources and their review; the check
            will report each of those sources as a missing document.
          </p>
          <ul aria-label="Tests that cite this document">
            {cited.slice(0, SHOWN).map((t) => (
              <li key={t.id}>
                <span className="mono">{t.key ?? t.id}</span>
                <span className="doc-cited-sum">{t.summary}</span>
                <ReviewBadge review={t.review} small />
              </li>
            ))}
          </ul>
          {cited.length > SHOWN && <p className="muted">and {cited.length - SHOWN} more</p>}
        </div>
      )}
      {plan && plan.unlinked.length > 0 && (
        <p className="muted">
          {plan.unlinked.length === 1 ? "This document amends it" : "These documents amend it"} and will no longer name
          it: <span className="mono">{plan.unlinked.join(", ")}</span>
        </p>
      )}
    </Confirm>
  );
}
