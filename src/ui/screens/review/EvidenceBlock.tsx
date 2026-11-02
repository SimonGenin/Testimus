import { type ReactNode, useEffect, useState } from "react";
import { call } from "../../api.ts";
import { Badge, Icon, Skeleton } from "../../components/ui/index.ts";
import { cx } from "../../lib/format.ts";

export type Evidence = {
  testId: string;
  jobId: string | null;
  consulted: string[];
  read: { ref: string; title: string; cited: boolean }[];
  related: { ref: string; kind: string; title: string; read: boolean; via: string }[];
  searched: { tool: string; query: string }[];
};

const KIND: Record<string, string> = {
  defines: "Defines",
  traces: "Traced to",
  mentions: "Mentions",
  amends: "Amends",
};

export function EvidenceBlock({
  testId,
  selected,
  onPick,
}: {
  testId: string;
  selected: string;
  onPick: (ref: string) => void;
}) {
  const [ev, setEv] = useState<Evidence | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setEv(null);
    setMissing(false);
    if (!testId) return;
    let dead = false;
    call<Evidence>("review.evidence", { testId })
      .then((r) => !dead && setEv(r))
      .catch(() => !dead && setMissing(true));
    return () => {
      dead = true;
    };
  }, [testId]);

  const unread = ev?.related.filter((r) => !r.read) ?? [];
  const summary = missing
    ? "Not recorded"
    : !ev
      ? null
      : `${ev.jobId === null ? "" : `${ev.read.length} read · `}${unread.length} related unread`;
  const ref = (r: string, title: string, extra?: ReactNode, cited?: boolean) => (
    <li key={r}>
      <button
        type="button"
        className={cx("ev-ref", selected === r && "ev-ref-on")}
        onClick={() => onPick(r)}
        aria-current={selected === r ? "true" : undefined}
      >
        <span className="mono ev-anchor">{r}</span>
        {title && <span className="ev-title">{title}</span>}
        {extra}
      </button>
      {cited && (
        <Badge tone="ok" icon="check" small title="A step cites it">
          Cited
        </Badge>
      )}
    </li>
  );

  return (
    <section className="evidence" aria-label="Sources read and related">
      <button
        type="button"
        className="ev-head"
        aria-expanded={open}
        aria-controls="ev-body"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={open ? "down" : "right"} />
        <span className="ev-head-title">Sources read / related</span>
        <span className="spacer" />
        {summary === null ? (
          <Skeleton w={110} h={12} />
        ) : (
          <span className={cx("ev-sum", unread.length > 0 && "ev-sum-warn")}>
            {unread.length > 0 && <Icon name="warning" size={13} />}
            {summary}
          </span>
        )}
      </button>
      {open && (
        <div id="ev-body" className="ev-body">
          {missing ? (
            <p className="muted">
              The generation's reading is not recorded for this test (written by hand, imported, or before Testimus kept
              it).
            </p>
          ) : !ev ? (
            <Skeleton h={40} />
          ) : (
            <>
              <span className="label">Read by the generation ({ev.read.length})</span>
              {ev.jobId === null ? (
                <p className="muted">Not recorded: this test was not written by a generation Testimus followed.</p>
              ) : ev.read.length ? (
                <ul className="ev-list">{ev.read.map((r) => ref(r.ref, r.title, null, r.cited))}</ul>
              ) : (
                <p className="muted">Nothing opened.</p>
              )}
              <span className="label">Related, not read ({unread.length})</span>
              {unread.length ? (
                <ul className="ev-list">
                  {unread.map((r) =>
                    ref(r.ref, r.title, <span className="muted ev-via">{r.via || KIND[r.kind] || r.kind}</span>),
                  )}
                </ul>
              ) : (
                <p className="muted">
                  {ev.related.length ? "Every related section was read." : "No related section found."}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
