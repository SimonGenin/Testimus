import { useEffect, useRef, useState } from "react";
import type { JobEvent } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { JobLog } from "../../components/shell/JobLog.tsx";
import { Button, Icon } from "../../components/ui/index.ts";
import { activityOf, coverage, DOING, lasted, lines, type Phase, type Span } from "../../lib/activity.ts";
import { cx, plural } from "../../lib/format.ts";
import { clock } from "../../lib/jobs.ts";

const sentence = (parts: string[]) =>
  `${[...new Set(parts)].map((p, i) => (i ? p.charAt(0).toLowerCase() + p.slice(1) : p)).join(", ")}.`;

function ReadBar({ spans, total, live }: { spans: Span[]; total: number | undefined; live: boolean }) {
  const c = coverage(spans);
  const known = spans.filter((s): s is { from: number; to: number } => s.to !== null);
  const end = Math.max(total ?? 0, c.last);
  const pct = (n: number) => `${(n / end) * 100}%`;
  const parts = [
    c.whole && !known.length
      ? "Read in one go"
      : `Lines ${lines(1)}–${lines(c.last)}${total ? ` of ${lines(total)}` : ""}, in ${plural(known.length, "page")}${c.inOrder ? ", front to back" : ""}`,
  ];
  if (c.read && c.read < c.last) parts.push(`${lines(c.last - c.read)} lines skipped`);
  parts.push(c.twice > 2 * known.length ? `${lines(c.twice)} lines read more than once` : "nothing read twice");
  return (
    <div className="readbar-wrap">
      {end > 0 && (
        <div
          className="readbar"
          role="img"
          aria-label={`Lines read: ${known.map((s) => `${s.from} to ${s.to}`).join(", ")}${total ? ` of ${total}` : ""}`}
        >
          {known.map((s, i) => (
            <span
              key={i}
              className={cx("readbar-page", live && i === known.length - 1 && "is-latest")}
              style={{ left: pct(s.from - 1), width: pct(s.to - s.from + 1) }}
            />
          ))}
        </div>
      )}
      <span className="act-line">{`${parts.join("; ")}.`}</span>
    </div>
  );
}

function title(p: Phase, live: boolean, planned: number): string {
  if (p.kind === "read") {
    const docs = p.reads.map((r) => r.doc);
    if (!docs.length) return live ? "Searching the documents" : "Searched the documents";
    return `${live ? "Reading" : "Read"} ${docs.join(", ")}`;
  }
  if (p.kind === "plan") return `${live ? "Planning" : "Planned"} ${plural(p.planned.length, "test")}`;
  if (p.kind === "write")
    return live
      ? `Writing the steps: ${p.written.length}${planned ? ` of ${planned}` : ""} done`
      : `Wrote the steps of ${plural(p.written.length, "test")}`;
  if (p.kind === "check") return live ? "Checking the new tests" : "Checked the new tests";
  if (p.kind === "end") return p.acts[p.acts.length - 1]?.text ?? "Finished";
  return live ? DOING.prepare : "Got ready";
}

function PhaseRow({
  phase: p,
  live,
  now,
  totals,
  planned,
}: {
  phase: Phase;
  live: boolean;
  now: number;
  totals: Record<string, number>;
  planned: number;
}) {
  const [open, setOpen] = useState(false);
  const warned = p.acts.some((a) => a.level === "warn");
  const last = p.written[p.written.length - 1];
  const steps = p.acts.length;
  return (
    <li className={cx("act-phase", live && "is-live", p.failed && "is-failed", p.kind === "end" && "is-end")}>
      <span className="act-mark" aria-hidden="true">
        {live ? <span className="dot run-dot" /> : <Icon name={p.failed ? "error" : warned ? "warning" : "check"} />}
      </span>
      <div className="act-body">
        <div className="act-head">
          <h3 className="act-title">{title(p, live, planned)}</h3>
          <span className="act-time">
            {clock(p.from)}
            {p.kind !== "end" && `, ${lasted(p.from, live ? new Date(now).toISOString() : p.to)}`}
          </span>
        </div>
        {p.kind === "prepare" && <span className="act-line">{sentence(p.acts.map((a) => a.text))}</span>}
        {p.reads.map((r) => (
          <ReadBar key={r.doc} spans={r.spans} total={totals[r.doc]} live={live} />
        ))}
        {p.kind === "read" && p.searches > 0 && (
          <span className="act-line">
            {p.reads.length ? "Also " : ""}
            {plural(p.searches, "lookup")} in the index (searches, passages, related sections).
          </span>
        )}
        {p.kind === "write" && last && (
          <span className="act-line">
            Last written: {last.summary ? `“${last.summary}”` : last.id}
            {p.written.some((w) => w.saves > 1) &&
              `; ${plural(p.written.filter((w) => w.saves > 1).length, "test")} written more than once`}
            .
          </span>
        )}
        {p.acts
          .filter((a) => a.level !== "info")
          .map((a, i) => (
            <span key={i} className={cx("act-line", a.level === "warn" ? "act-warn" : "act-error")}>
              {a.text}
            </span>
          ))}
        {p.kind !== "end" && steps > 1 && (
          <Button
            tone="quiet"
            size="sm"
            icon={open ? "down" : "right"}
            aria-expanded={open}
            className="act-toggle"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "Hide" : "Show"} the {steps} actions
          </Button>
        )}
        {open && (
          <ol className="act-steps">
            {p.acts.map((a, i) => (
              <li key={i} className={cx(a.level === "warn" && "act-warn", a.level === "error" && "act-error")}>
                <span className="act-at">{clock(a.at)}</span>
                {a.text}
              </li>
            ))}
          </ol>
        )}
      </div>
    </li>
  );
}

export function GenActivity({ events, running, now }: { events: JobEvent[]; running: boolean; now: number }) {
  const [shown, setShown] = useState(true);
  const [raw, setRaw] = useState(false);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const asked = useRef(new Set<string>());
  const phases = activityOf(events);
  const want = [...new Set(phases.flatMap((p) => p.reads.map((r) => r.doc)))].join("|");
  useEffect(() => {
    for (const id of want ? want.split("|") : []) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      call<{ md: string }>("docs.show", { id })
        .then((r) => setTotals((t) => ({ ...t, [id]: r?.md ? r.md.split(/\r?\n/).length : 0 })))
        .catch(() => setTotals((t) => ({ ...t, [id]: 0 })));
    }
  }, [want]);
  const planned = phases.reduce((n, p) => n + p.planned.length, 0);
  return (
    <section className="card act" aria-label="What Claude did">
      <h2 className="act-heading">
        <button
          type="button"
          className="act-fold"
          aria-expanded={shown}
          aria-controls="act-body"
          onClick={() => setShown((s) => !s)}
        >
          <Icon name={shown ? "down" : "right"} />
          What Claude did
          {!shown && phases.length > 0 && (
            <>
              {" "}
              <span className="act-fold-sum">{plural(phases.length, "phase")}</span>
            </>
          )}
        </button>
      </h2>
      {shown && (
        <div id="act-body" className="act-content">
          {!phases.length && (
            <p className="muted">{running ? "Claude is starting." : "Nothing was recorded for this run."}</p>
          )}
          <ol className="act-phases">
            {phases.map((p, i) => (
              <PhaseRow
                key={`${p.kind}-${p.from}`}
                phase={p}
                live={running && i === phases.length - 1}
                now={now}
                totals={totals}
                planned={planned}
              />
            ))}
          </ol>
          <Button
            tone="quiet"
            size="sm"
            icon={raw ? "down" : "right"}
            aria-expanded={raw}
            className="act-raw"
            onClick={() => setRaw((r) => !r)}
          >
            {raw ? "Hide" : "Show"} the raw log ({plural(events.length, "event")})
          </Button>
          {raw && <JobLog events={events} label="Raw log" />}
        </div>
      )}
    </section>
  );
}
