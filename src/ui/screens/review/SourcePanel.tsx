import { useEffect, useState } from "react";
import type { Finding, Passage, Source } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { DocBadges, PassageText } from "../../components/sources/PassageView.tsx";
import { Button, IconButton, Severity, Skeleton } from "../../components/legacy/index.ts";
import { docGone, goneText } from "../../lib/docGone.ts";
import { message } from "../../lib/format.ts";
import { EvidenceBlock } from "./EvidenceBlock.tsx";

export function notAtAnchor(findings: Finding[], ref: string, step: number | null): Finding | undefined {
  return findings.find(
    (f) => f.kind === "quote-not-at-anchor" && f.sources[0] === ref && (step === null || f.step === step),
  );
}

export function SourcePanel({
  source,
  label,
  index,
  total,
  testId,
  misplaced,
  onClose,
  onOpenDoc,
  onPick,
}: {
  source: Source;
  label: string;
  index: number;
  total: number;
  testId: string;
  misplaced?: Finding;
  onClose: () => void;
  onOpenDoc: (docId: string, anchor: string, quote: string) => void;
  onPick: (ref: string) => void;
}) {
  const [p, setP] = useState<(Passage & { quoteFound?: boolean }) | null>(null);
  const [error, setError] = useState("");
  const [gone, setGone] = useState(false);
  const ref = `${source.docId}#${source.anchor}`;
  const docId = source.docId;
  const quote = source.quote;
  useEffect(() => {
    setP(null);
    setError("");
    setGone(false);
    let dead = false;
    call<Passage & { quoteFound?: boolean }>("rag.passage", quote.trim() ? { ref, around: quote } : { ref })
      .then((r) => !dead && setP(r))
      .catch((e) => {
        if (dead) return;
        setError(message(e));
        void docGone(docId).then((g) => !dead && setGone(g));
      });
    return () => {
      dead = true;
    };
  }, [ref, docId, quote]);

  const evidence = testId ? <EvidenceBlock testId={testId} selected={ref} onPick={onPick} /> : null;

  return (
    <aside className="srcpanel" aria-label="Source passage">
      <div className="srcpanel-head">
        <div className="srcpanel-top">
          <span className="label">{label}</span>
          <IconButton icon="close" label="Close the source" onClick={onClose} />
        </div>
        <span className="mono srcpanel-code">{p ? `${p.doc.code} · v${p.doc.version}` : source.docId}</span>
        {p ? <h3 className="h srcpanel-title">{p.doc.title}</h3> : !error && <Skeleton w={140} h={18} />}
        {p && (
          <div className="chips">
            <DocBadges status={p.doc.status} />
          </div>
        )}
      </div>
      <div className="srcpanel-body" aria-busy={!p && !error}>
        {misplaced && (
          <div className="srcpanel-misplaced" role="status">
            <Severity tone="error">Quote not at this anchor</Severity>
            <p>{misplaced.message}</p>
            <p className="muted">Not highlighted: the passage below does not hold the quote.</p>
          </div>
        )}
        {gone ? (
          <div className="srcpanel-miss" role="status">
            <Severity tone="error">Document deleted</Severity>
            <p>{goneText(source.docId)}</p>
            {source.quote && <p className="q">« {source.quote} »</p>}
          </div>
        ) : error ? (
          <div className="srcpanel-miss" role="status">
            <p>
              <strong>This passage could not be shown.</strong> {error}
            </p>
            {source.quote && <p className="q">« {source.quote} »</p>}
          </div>
        ) : !p ? (
          <>
            <Skeleton w="45%" h={10} />
            <Skeleton w="60%" h={16} />
            <Skeleton w="96%" h={13} />
            <Skeleton w="92%" h={13} />
            <Skeleton w="80%" h={13} />
            <Skeleton w="88%" h={13} />
          </>
        ) : misplaced ? (
          <PassageText passage={p} quote="" />
        ) : quote.trim() && p.quoteFound === false ? (
          <>
            <div className="srcpanel-miss" role="status">
              <p className="muted">
                Not highlighted: the quote is not in this section’s own text (it may sit in a sub-section) — use Open in
                document to find it.
              </p>
            </div>
            <PassageText passage={p} quote="" />
          </>
        ) : (
          <PassageText passage={p} quote={source.quote} />
        )}
      </div>
      {evidence}
      <div className="srcpanel-foot">
        {!gone && (
          <Button size="sm" icon="external" onClick={() => onOpenDoc(source.docId, source.anchor, source.quote)}>
            Open in document
          </Button>
        )}
        <span className="spacer" />
        {total > 0 && (
          <span className="muted srcpanel-count">{`${index + 1} of ${total} source${total > 1 ? "s" : ""}`}</span>
        )}
      </div>
    </aside>
  );
}
