import { useEffect, useRef, useState } from "react";
import type { JobEvent } from "../../../core/types.ts";
import { call } from "../../api.ts";
import {
  activityOf,
  DOING,
  type Lookup,
  lasted,
  lines,
  linesRead,
  type Outline,
  outlineOf,
  type Phase,
  type Span,
  type Verdict,
} from "../../lib/activity.ts";
import { cx, plural } from "../../lib/format.ts";
import { clock } from "../../lib/jobs.ts";
import { JobLog } from "../shell/JobLog.tsx";
import { Button, Icon } from "../legacy/index.ts";

const sentence = (parts: string[]) =>
  `${[...new Set(parts)].map((p, i) => (i ? p.charAt(0).toLowerCase() + p.slice(1) : p)).join(", ")}.`;
const unique = (xs: string[]) => [...new Set(xs.filter(Boolean))];
const opened = (p: Phase, doc: string) => p.lookups.filter((l) => l.kind === "open" && l.doc === doc);
const docsOf = (p: Phase) =>
  unique([...p.reads.map((r) => r.doc), ...p.lookups.filter((l) => l.kind === "open").map((l) => l.doc)]);

function readLine(spans: Span[], total: number | undefined): string {
  const c = linesRead(spans);
  const known = spans.filter((s): s is { from: number; to: number } => s.to !== null);
  const parts = [
    c.whole && !known.length
      ? "Read in one go"
      : `Lines ${lines(1)}–${lines(c.last)}${total ? ` of ${lines(total)}` : ""}, in ${plural(known.length, "page")}${c.inOrder ? ", front to back" : ""}`,
  ];
  if (c.read && c.read < c.last) parts.push(`${lines(c.last - c.read)} lines skipped`);
  parts.push(c.twice > 2 * known.length ? `${lines(c.twice)} lines read more than once` : "nothing read twice");
  return `${parts.join("; ")}.`;
}

function DocMap({
  spans,
  hits,
  outline,
  live,
}: {
  spans: Span[];
  hits: Lookup[];
  outline: Outline | null | undefined;
  live: boolean;
}) {
  const known = spans.filter((s): s is { from: number; to: number } => s.to !== null);
  const anchors = unique(hits.map((h) => h.anchor));
  const pins = anchors.flatMap((a) => {
    const at = outline?.anchors.get(a);
    return at ? [{ anchor: a, ...at }] : [];
  });
  const end = Math.max(outline?.total ?? 0, linesRead(spans).last, ...pins.map((p) => p.line));
  const pct = (n: number) => `${(n / end) * 100}%`;
  return (
    <div className="docmap">
      {end > 0 && (
        <div className={cx("docmap-track", pins.length > 0 && "has-pins")}>
          {pins.map((p) => (
            <span
              key={p.anchor}
              className="docmap-pin"
              style={{ left: pct(p.line - 1) }}
              title={`${p.anchor} ${p.title} · line ${lines(p.line)}`.replace(/\s+·/, " ·")}
            />
          ))}
          <div
            className="readbar"
            role="img"
            aria-label={`Lines read: ${known.map((s) => `${s.from} to ${s.to}`).join(", ")}${outline?.total ? ` of ${outline.total}` : ""}`}
          >
            {outline?.chapters.slice(1).map((l) => (
              <span key={l} className="readbar-chapter" style={{ left: pct(l - 1) }} />
            ))}
            {known.map((s, i) => (
              <span
                key={i}
                className={cx("readbar-page", live && i === known.length - 1 && "is-latest")}
                style={{ left: pct(s.from - 1), width: pct(s.to - s.from + 1) }}
              />
            ))}
          </div>
        </div>
      )}
      <p className="docmap-legend">
        {spans.length > 0 && (
          <span>
            <i className="docmap-swatch" aria-hidden="true" />
            {readLine(spans, outline?.total)}
          </span>
        )}
        {anchors.length > 0 && (
          <span>
            <i className="docmap-dot" aria-hidden="true" />
            {plural(anchors.length, "section")} opened from the index
          </span>
        )}
      </p>
    </div>
  );
}

function Searches({ p }: { p: Phase }) {
  const queries = unique(p.lookups.filter((l) => l.kind === "search").map((l) => l.text));
  if (!queries.length) return null;
  return (
    <p className="act-search">
      <Icon name="search" />
      Searched for
      {queries.slice(0, 3).map((q) => (
        <span key={q} className="act-query">
          “{q}”
        </span>
      ))}
      {queries.length > 3 && <span className="muted">and {queries.length - 3} more</span>}
    </p>
  );
}

function Lookups({ p, outlines }: { p: Phase; outlines: Record<string, Outline | null> }) {
  const docs = docsOf(p);
  const titled = (l: Lookup) => {
    const at = outlines[l.doc]?.anchors.get(l.anchor);
    return { ...l, title: at?.title ?? "", line: at?.line ?? 0 };
  };
  const seen = new Set<string>();
  const opens = p.lookups.filter((l) => l.kind === "open" && !seen.has(l.text) && seen.add(l.text)).map(titled);
  const follows = unique(p.lookups.filter((l) => l.kind === "follow").map((l) => l.text));
  const searches = unique(p.lookups.filter((l) => l.kind === "search").map((l) => l.text));
  const mentions = unique(p.lookups.filter((l) => l.kind === "mention").map((l) => l.text));
  const quote = (q: string) => (
    <span key={q} className="act-query">
      “{q}”
    </span>
  );
  return (
    <dl className="act-lookups">
      {p.reads.map((r) => (
        <div key={r.doc} className="act-lookup">
          <dt>Read{docs.length > 1 ? ` ${r.doc}` : ""}</dt>
          <dd>
            {r.spans
              .map((s) => (s.to === null ? "the whole document" : `lines ${lines(s.from)}–${lines(s.to)}`))
              .join(", ")}
          </dd>
        </div>
      ))}
      {searches.length > 0 && (
        <div className="act-lookup">
          <dt>Searched for</dt>
          <dd className="act-queries">{searches.map(quote)}</dd>
        </div>
      )}
      {opens.length > 0 && (
        <div className="act-lookup">
          <dt>Opened</dt>
          <dd className="act-opened">
            {opens.map((o) => (
              <span key={o.text} className="act-open">
                <code>{docs.length > 1 ? o.text : o.anchor || o.doc}</code>
                <span>{o.title}</span>
                <span className="muted">{o.line ? `line ${lines(o.line)}` : ""}</span>
              </span>
            ))}
          </dd>
        </div>
      )}
      {follows.length > 0 && (
        <div className="act-lookup">
          <dt>Followed links from</dt>
          <dd className="act-queries">
            {follows.map((f) => (
              <code key={f}>{f}</code>
            ))}
          </dd>
        </div>
      )}
      {mentions.length > 0 && (
        <div className="act-lookup">
          <dt>Every mention of</dt>
          <dd className="act-queries">{mentions.map(quote)}</dd>
        </div>
      )}
    </dl>
  );
}

function verdictOf(v: Verdict): { label: string; tone: "ok" | "warn" | "err" } {
  if (v.failed) return { label: "Check failed", tone: "err" };
  const found = [v.errors ? plural(v.errors, "error") : "", v.warnings ? plural(v.warnings, "warning") : ""];
  if (!v.errors && !v.warnings) return { label: "No anomaly", tone: "ok" };
  return { label: found.filter(Boolean).join(", "), tone: v.errors ? "err" : "warn" };
}

function title(p: Phase, live: boolean, planned: number, afterCheck: boolean): string {
  if (p.kind === "read") {
    const docs = docsOf(p);
    if (!docs.length) return live ? "Searching the documents" : "Searched the documents";
    return `${live ? "Reading" : "Read"} ${docs.join(", ")}`;
  }
  if (p.kind === "plan") return `${live ? "Planning" : "Planned"} ${plural(p.planned.length, "test")}`;
  if (p.kind === "write" && afterCheck)
    return live
      ? "Editing the steps after the check"
      : `Edited the steps of ${plural(p.written.length, "test")} after the check`;
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
  outlines,
  planned,
  afterCheck,
  names,
}: {
  phase: Phase;
  live: boolean;
  now: number;
  outlines: Record<string, Outline | null>;
  planned: number;
  afterCheck: boolean;
  names: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [inOrder, setInOrder] = useState(false);
  const warned = p.acts.some((a) => a.level === "warn");
  const last = p.written[p.written.length - 1];
  const steps = p.acts.length;
  const grouped = p.lookups.length > 0 && !inOrder;
  const others = p.acts.filter((a) => a.level === "info" && !/^Opened the .* instructions$/.test(a.text));
  const said = p.said[p.said.length - 1];
  return (
    <li className={cx("act-phase", live && "is-live", p.failed && "is-failed", p.kind === "end" && "is-end")}>
      <span className="act-mark" aria-hidden="true">
        {live ? <span className="dot run-dot" /> : <Icon name={p.failed ? "error" : warned ? "warning" : "check"} />}
      </span>
      <div className="act-body">
        <div className="act-head">
          <h3 className="act-title">{title(p, live, planned, afterCheck)}</h3>
          <span className="act-time">
            {clock(p.from)}
            {p.kind !== "end" && `, ${lasted(p.from, live ? new Date(now).toISOString() : p.to)}`}
          </span>
        </div>
        {p.skills.length > 0 && (
          <span className="act-line">
            Followed the skill{p.skills.length > 1 ? "s" : ""}{" "}
            {p.skills.map((s) => (
              <span key={s} className="act-skill">
                {s}
              </span>
            ))}
          </span>
        )}
        {p.kind === "prepare" && others.length > 0 && (
          <span className="act-line">{sentence(others.map((a) => a.text))}</span>
        )}
        {docsOf(p).map((doc) => (
          <DocMap
            key={doc}
            spans={p.reads.find((r) => r.doc === doc)?.spans ?? []}
            hits={opened(p, doc)}
            outline={outlines[doc]}
            live={live}
          />
        ))}
        {p.kind === "read" && <Searches p={p} />}
        {p.kind === "plan" && p.planned.length > 0 && (
          <ol className="act-plan">
            {p.planned.map((t, i) => (
              <li key={i}>
                <span className="act-n">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
        )}
        {p.kind === "write" && last && (
          <span className="act-line">
            Last written: {last.summary ? `“${last.summary}”` : last.id}
            {p.written.some((w) => w.saves > 1) &&
              `; ${plural(p.written.filter((w) => w.saves > 1).length, "test")} written more than once`}
            .
          </span>
        )}
        {p.verdicts.length > 0 && (
          <ul className="act-verdicts">
            {p.verdicts.map((v) => {
              const { label, tone } = verdictOf(v);
              return (
                <li key={v.id}>
                  <span className="mono act-id">{v.id}</span>
                  <span className="act-name">{names.get(v.id) ?? ""}</span>
                  <span className={cx("act-verdict", `is-${tone}`)}>{label}</span>
                </li>
              );
            })}
          </ul>
        )}
        {p.acts
          .filter((a) => a.level !== "info")
          .map((a, i) => (
            <span key={i} className={cx("act-line", a.level === "warn" ? "act-warn" : "act-error")}>
              {a.text}
            </span>
          ))}
        {said && p.kind !== "end" && (
          <p className="act-said">
            <Icon name="claude" />
            {said}
          </p>
        )}
        {p.kind !== "end" && steps > 1 && (
          <div className="act-toggles">
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
            {open && p.lookups.length > 0 && (
              <Button tone="quiet" size="sm" className="act-order" onClick={() => setInOrder((o) => !o)}>
                {inOrder ? "Grouped" : "In order, one per line"}
              </Button>
            )}
          </div>
        )}
        {open && grouped && <Lookups p={p} outlines={outlines} />}
        {open && !grouped && (
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

export function ClaudeActivity({
  events,
  running,
  now,
  label = "What Claude did",
}: {
  events: JobEvent[];
  running: boolean;
  now: number;
  label?: string;
}) {
  const [shown, setShown] = useState(true);
  const [raw, setRaw] = useState(false);
  const [outlines, setOutlines] = useState<Record<string, Outline | null>>({});
  const asked = useRef(new Set<string>());
  const phases = activityOf(events);
  const want = unique(phases.flatMap(docsOf)).join("|");
  useEffect(() => {
    for (const id of want ? want.split("|") : []) {
      if (asked.current.has(id)) continue;
      asked.current.add(id);
      call<{ md: string }>("docs.show", { id })
        .then((r) => setOutlines((o) => ({ ...o, [id]: r?.md ? outlineOf(r.md) : null })))
        .catch(() => setOutlines((o) => ({ ...o, [id]: null })));
    }
  }, [want]);
  const planned = phases.reduce((n, p) => n + p.planned.length, 0);
  const names = new Map(phases.flatMap((p) => p.written.filter((w) => w.summary).map((w) => [w.id, w.summary])));
  return (
    <section className="card act" aria-label={label}>
      <h2 className="act-heading">
        <button
          type="button"
          className="act-fold"
          aria-expanded={shown}
          aria-controls="act-body"
          onClick={() => setShown((s) => !s)}
        >
          <Icon name={shown ? "down" : "right"} />
          {label}
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
                outlines={outlines}
                planned={planned}
                afterCheck={phases.slice(0, i).some((x) => x.kind === "check")}
                names={names}
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
