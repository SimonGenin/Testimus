import { useEffect, useState } from "react";
import { call } from "../../api.ts";
import { Badge, Icon, Skeleton } from "../../components/legacy/index.ts";
import { cx } from "../../lib/format.ts";

export type Evidence = {
  testId: string;
  jobId: string | null;
  consulted: string[];
  read: { ref: string; title: string; cited: boolean }[];
  searched: { tool: string; query: string }[];
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

  const summary = missing || ev?.jobId === null ? "Not recorded" : !ev ? null : `${ev.read.length} read`;
  const ref = (r: string, title: string, cited: boolean) => (
    <li key={r}>
      <button
        type="button"
        className={cx("ev-ref", selected === r && "ev-ref-on")}
        onClick={() => onPick(r)}
        aria-current={selected === r ? "true" : undefined}
      >
        <span className="mono ev-anchor">{r}</span>
        {title && <span className="ev-title">{title}</span>}
      </button>
      {cited && (
        <Badge tone="ok" icon="check" small title="A step cites it">
          Cited
        </Badge>
      )}
    </li>
  );

  return (
    <section className="evidence" aria-label="Sources read">
      <button
        type="button"
        className="ev-head"
        aria-expanded={open}
        aria-controls="ev-body"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={open ? "down" : "right"} />
        <span className="ev-head-title">Sources read</span>
        <span className="spacer" />
        {summary === null ? <Skeleton w={110} h={12} /> : <span className="ev-sum">{summary}</span>}
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
                <ul className="ev-list">{ev.read.map((r) => ref(r.ref, r.title, r.cited))}</ul>
              ) : (
                <p className="muted">Nothing opened.</p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
