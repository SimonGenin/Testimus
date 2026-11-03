import { useEffect, useState } from "react";
import type { Passage, Source } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { docGone, goneText } from "../../lib/docGone.ts";
import { sourceLabel } from "../../lib/fields.ts";
import { message } from "../../lib/format.ts";
import { Button, Modal, Severity, Skeleton } from "../ui/index.ts";
import { DocBadges, PassageText } from "./PassageView.tsx";

export { highlight } from "./PassageView.tsx";

export function PassageDialog({
  source,
  onClose,
  onOpenDoc,
}: {
  source: Source;
  onClose: () => void;
  onOpenDoc?: (docId: string, anchor: string) => void;
}) {
  const [p, setP] = useState<Passage | null>(null);
  const [error, setError] = useState("");
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let dead = false;
    call<Passage>("rag.passage", { ref: `${source.docId}#${source.anchor}` })
      .then((r) => !dead && setP(r))
      .catch((e) => {
        if (dead) return;
        setError(message(e));
        void docGone(source.docId).then((g) => !dead && setGone(g));
      });
    return () => {
      dead = true;
    };
  }, [source.docId, source.anchor]);
  return (
    <Modal
      label={`Source ${sourceLabel(source)}`}
      title={p?.doc.title || sourceLabel(source)}
      subtitle={
        <span className="mono">
          {p ? `${p.doc.code} · v${p.doc.version}` : source.docId} · {source.anchor}
        </span>
      }
      width={900}
      className="passage"
      onClose={onClose}
      foot={
        <>
          {onOpenDoc && !gone && (
            <Button size="sm" icon="external" onClick={() => onOpenDoc(source.docId, source.anchor)}>
              Open in document
            </Button>
          )}
          <div className="spacer" />
          <Button tone="quiet" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {gone ? (
        <div className="passage-body" role="status">
          <Severity tone="error">Document deleted</Severity>
          <p>{goneText(source.docId)}</p>
          {source.quote && <p className="q">« {source.quote} »</p>}
        </div>
      ) : error ? (
        <div className="passage-body">
          <p>This passage could not be shown: {error}</p>
          {source.quote && <p className="q">« {source.quote} »</p>}
        </div>
      ) : !p ? (
        <div className="passage-body" role="status" aria-busy="true" aria-label="Loading the passage">
          <Skeleton w="40%" h={10} />
          <Skeleton w="95%" h={14} />
          <Skeleton w="88%" h={14} />
          <Skeleton w="70%" h={14} />
        </div>
      ) : (
        <div className="passage-body">
          <div className="passage-meta">
            <DocBadges status={p.doc.status} />
          </div>
          <PassageText passage={p} quote={source.quote} />
        </div>
      )}
    </Modal>
  );
}
