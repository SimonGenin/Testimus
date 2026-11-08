import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { Job, JobEvent } from "../../../core/types.ts";
import { activityOf, DOING, lasted, type Phase, type Verdict } from "../../lib/activity.ts";
import { plural } from "../../lib/format.ts";
import { clock } from "../../lib/jobs.ts";
import { isLocalId, type TestNames, UNTITLED_TEST, useTestNames } from "../../lib/labels.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { JobLog } from "../shell/JobLog.tsx";
import { Badge, type BadgeTone } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Card } from "../ui/Card.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Timeline, type TimelineItem } from "../ui/Timeline.tsx";
import { type } from "../ui/type.ts";
import { DocMap, docsOf, Lookups, Searches } from "./ActivityParts.tsx";
import { kilo } from "./turns.ts";
import { claudeSaid } from "./useClaudeStatus.ts";

const styles = stylex.create({
  heading: { margin: 0, font: "inherit" },
  body: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  line: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s2, color: color.text },
  quiet: { color: color.textMuted },
  warn: { color: color.warning },
  error: { color: color.danger },
  plan: {
    boxSizing: "border-box",
    margin: 0,
    paddingInlineStart: space.s6,
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
  },
  verdicts: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space.s2 },
  verdict: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  id: { color: color.textMuted },
  name: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  said: { display: "flex", alignItems: "flex-start", gap: space.s2, margin: 0, color: color.textMuted },
  spark: { display: "inline-flex", flex: "none", marginTop: space.s1, color: color.claudeText },
  steps: { margin: 0, paddingInlineStart: space.s5, display: "flex", flexDirection: "column", gap: space.s1 },
  at: { color: color.textSubtle, marginInlineEnd: space.s2 },
  muted: { margin: 0, color: color.textSubtle },
});

const mss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// the model and effort a job's run asked for (its input), else the project's defaults it fell back on
export function askedOf(
  job: Pick<Job, "rerun"> | null | undefined,
  defaults?: { model?: string; effort?: string },
): { model?: string; effort?: string } {
  const asked = (job?.rerun?.input ?? {}) as { model?: unknown; effort?: unknown };
  const pick = (v: unknown, d?: string) => (typeof v === "string" && v ? v : d || undefined);
  return { model: pick(asked.model, defaults?.model), effort: pick(asked.effort, defaults?.effort) };
}

// the head's line (design jobs-claude): model · effort · m:ss · tokens, from what the run reported at its end
export function runLine(events: JobEvent[], model?: string, effort?: string): string {
  const end = events.flatMap((e) => (e.type === "claude" && e.event.type === "result" ? [e.event] : [])).pop();
  return [
    model ?? "",
    effort ?? "",
    end ? mss(end.durationMs) : "",
    end?.tokens ? `${kilo(end.tokens.input)} tokens in · ${kilo(end.tokens.output)} out` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const sentence = (parts: string[]) =>
  `${[...new Set(parts)].map((p, i) => (i ? p.charAt(0).toLowerCase() + p.slice(1) : p)).join(", ")}.`;

function verdictOf(v: Verdict): { label: string; tone: BadgeTone; kind: "ok" | "warn" | "err" } {
  if (v.failed) return { label: "Check failed", tone: "danger", kind: "err" };
  if (!v.errors && !v.warnings) return { label: "No anomaly", tone: "success", kind: "ok" };
  const found = [v.errors ? plural(v.errors, "error") : "", v.warnings ? plural(v.warnings, "warning") : ""];
  return {
    label: found.filter(Boolean).join(", "),
    tone: v.errors ? "danger" : "warning",
    kind: v.errors ? "err" : "warn",
  };
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

function PhaseBody({ phase: p, live, names }: { phase: Phase; live: boolean; names: TestNames }) {
  const [open, setOpen] = useState(false);
  const [inOrder, setInOrder] = useState(false);
  const last = p.written[p.written.length - 1];
  const steps = p.acts.length;
  const grouped = p.lookups.length > 0 && !inOrder;
  const others = p.acts.filter((a) => a.level === "info" && !/^Opened the .* instructions$/.test(a.text));
  const said = p.said[p.said.length - 1];
  return (
    <div {...stylex.props(styles.body)}>
      {p.skills.length > 0 && (
        <span {...stylex.props(type.compact, styles.line)}>
          Followed the skill{p.skills.length > 1 ? "s" : ""}
          {p.skills.map((s) => (
            <span key={s} data-testid="act-skill">
              <Badge label={s} tone="claude" icon="layers" size="sm" />
            </span>
          ))}
        </span>
      )}
      {p.kind === "prepare" && others.length > 0 && (
        <span {...stylex.props(type.compact, styles.line, styles.quiet)}>{sentence(others.map((a) => a.text))}</span>
      )}
      {docsOf(p).map((doc) => (
        <DocMap
          key={doc}
          doc={doc}
          spans={p.reads.find((r) => r.doc === doc)?.spans ?? []}
          hits={p.lookups.filter((l) => l.kind === "open" && l.doc === doc)}
          live={live}
        />
      ))}
      {p.kind === "read" && <Searches p={p} />}
      {p.kind === "plan" && p.planned.length > 0 && (
        <ol {...stylex.props(type.compact, styles.plan)}>
          {p.planned.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      )}
      {p.kind === "write" && last && (
        <span {...stylex.props(type.compact, styles.quiet)}>
          Last written: “{last.summary || names(last.id) || UNTITLED_TEST}”
          {p.written.some((w) => w.saves > 1) &&
            `; ${plural(p.written.filter((w) => w.saves > 1).length, "test")} written more than once`}
          .
        </span>
      )}
      {p.verdicts.length > 0 && (
        <ul aria-label="Check verdicts" {...stylex.props(type.compact, styles.verdicts)}>
          {p.verdicts.map((v) => {
            const { label, tone, kind } = verdictOf(v);
            return (
              <li key={v.id} data-verdict={kind} {...stylex.props(styles.verdict)}>
                {!v.name && !isLocalId(v.id) && <span {...stylex.props(type.code, styles.id)}>{v.id}</span>}
                <span {...stylex.props(styles.name)}>
                  {v.name ?? names(v.id) ?? (isLocalId(v.id) ? UNTITLED_TEST : "")}
                </span>
                <Badge tone={tone} size="sm" label={label} />
              </li>
            );
          })}
        </ul>
      )}
      {p.acts
        .filter((a) => a.level !== "info")
        .map((a, i) => (
          <span
            key={i}
            data-level={a.level}
            {...stylex.props(type.compact, a.level === "warn" ? styles.warn : styles.error)}
          >
            {a.text}
          </span>
        ))}
      {said && p.kind !== "end" && (
        <p data-testid="act-said" {...stylex.props(type.compact, styles.said)}>
          <span {...stylex.props(styles.spark)}>
            <Icon name="claude" size="sm" />
          </span>
          {said}
        </p>
      )}
      {p.kind !== "end" && steps > 1 && (
        <Disclosure
          quiet
          summary={`${open ? "Hide" : "Show"} the ${steps} actions`}
          open={open}
          onOpenChange={setOpen}
          meta={
            open &&
            p.lookups.length > 0 && (
              <Button
                variant="quiet"
                size="sm"
                label={inOrder ? "Grouped" : "In order, one per line"}
                onClick={() => setInOrder((o) => !o)}
              />
            )
          }
        >
          {grouped ? (
            <Lookups p={p} />
          ) : (
            <ol {...stylex.props(type.small, styles.steps)}>
              {p.acts.map((a, i) => (
                <li
                  key={i}
                  data-level={a.level}
                  {...stylex.props(a.level === "warn" && styles.warn, a.level === "error" && styles.error)}
                >
                  <span {...stylex.props(type.mono, styles.at)}>{clock(a.at)}</span>
                  {a.text}
                </li>
              ))}
            </ol>
          )}
        </Disclosure>
      )}
    </div>
  );
}

// ponytail: « What Claude did » (« What Claude is doing » while it runs) — a Claude run folded into phases (got ready, read, planned, wrote, checked), each
// with what it read and where, what it wrote and the check's verdicts; the raw output on demand, at its foot
export function ClaudeActivity({
  events,
  running,
  now,
  model,
  effort,
  open,
  onOpenChange,
}: {
  events: JobEvent[];
  running: boolean;
  now: number;
  /** the run's model and effort, from the job's input: they open the head's line */
  model?: string;
  effort?: string;
  /** controlled by the screen (Generate's « Fold all »); open at first otherwise */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [own, setOwn] = useState(true);
  const shown = open ?? own;
  const setShown = (v: boolean) => {
    setOwn(v);
    onOpenChange?.(v);
  };
  const [raw, setRaw] = useState(false);
  const nameOf = useTestNames();
  const phases = activityOf(events, nameOf);
  const head = runLine(events, model, effort);
  const planned = phases.reduce((n, p) => n + p.planned.length, 0);
  const written = new Map(phases.flatMap((p) => p.written.filter((w) => w.summary).map((w) => [w.id, w.summary])));
  const names: TestNames = (id) => written.get(id) || nameOf(id);
  // ponytail: a run whose Claude stopped on an error does not end on a green « Done »
  const stopped = !running && !!claudeSaid(events);
  // ponytail: the head says where the run is — while Claude works it is not yet « what Claude did »
  const label = running ? "What Claude is doing" : stopped ? "What Claude did before it stopped" : "What Claude did";
  const items: TimelineItem[] = phases.map((p, i) => {
    const live = running && i === phases.length - 1;
    const warned = p.acts.some((a) => a.level === "warn");
    const failedEnd = stopped && p.kind === "end";
    const said = title(
      p,
      live,
      planned,
      phases.slice(0, i).some((x) => x.kind === "check"),
    );
    return {
      key: `${p.kind}-${p.from}`,
      state: live ? "running" : p.failed || failedEnd ? "failed" : "done",
      title: <h3 {...stylex.props(styles.heading)}>{failedEnd ? said.replace(/^Done\b/, "Stopped") : said}</h3>,
      time: `${clock(p.from)}${p.kind !== "end" ? `, ${lasted(p.from, live ? new Date(now).toISOString() : p.to)}` : ""}`,
      note: warned ? <Icon name="alert-triangle" size="sm" label="Warnings" /> : undefined,
      children: <PhaseBody phase={p} live={live} names={names} />,
    };
  });
  const line = [head, !shown && phases.length > 0 ? plural(phases.length, "phase") : ""].filter(Boolean).join(" · ");
  return (
    <Card density="compact">
      <Disclosure icon="claude" summary={label} open={shown} onOpenChange={setShown} meta={line}>
        {!phases.length && (
          <p {...stylex.props(type.compact, styles.muted)}>
            {running ? "Claude is starting." : "Nothing was recorded for this run."}
          </p>
        )}
        {phases.length > 0 && <Timeline label="Phases" tone="claude" items={items} />}
        <Disclosure
          quiet
          summary={`${raw ? "Hide" : "Show"} raw output (${plural(events.length, "event")})`}
          open={raw}
          onOpenChange={setRaw}
        >
          <JobLog events={events} label="Raw output" />
        </Disclosure>
      </Disclosure>
    </Card>
  );
}
