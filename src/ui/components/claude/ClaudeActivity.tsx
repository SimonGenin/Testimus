import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { JobEvent } from "../../../core/types.ts";
import { activityOf, DOING, lasted, type Phase, type Verdict } from "../../lib/activity.ts";
import { plural } from "../../lib/format.ts";
import { clock } from "../../lib/jobs.ts";
import { color, fontFamily, fontSize, fontWeight, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { JobLog } from "../shell/JobLog.tsx";
import { Badge, type BadgeTone } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Timeline, type TimelineItem } from "../ui/Timeline.tsx";
import { DocMap, docsOf, Lookups, Searches } from "./ActivityParts.tsx";
import { kilo } from "./turns.ts";

const styles = stylex.create({
  card: { display: "flex", flexDirection: "column", gap: space.s3 },
  heading: { margin: 0, fontSize: "inherit", fontWeight: "inherit", lineHeight: "inherit" },
  body: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  line: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
  warn: { color: color.warning },
  error: { color: color.danger },
  skill: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    color: color.claudeText,
    marginInlineStart: space.s1,
  },
  plan: {
    boxSizing: "border-box",
    margin: 0,
    paddingInlineStart: space.s5,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
  },
  verdicts: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.s2,
    fontSize: fontSize.small,
  },
  verdict: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  id: { fontFamily: fontFamily.mono, fontSize: fontSize.code, color: color.textMuted },
  name: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  said: {
    display: "flex",
    gap: space.s2,
    margin: 0,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.claudeText,
  },
  toggles: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  steps: {
    margin: 0,
    paddingInlineStart: space.s5,
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
  },
  at: { fontFamily: fontFamily.mono, color: color.textSubtle, marginInlineEnd: space.s2 },
  muted: { margin: 0, fontSize: fontSize.small, color: color.textSubtle, fontWeight: fontWeight.regular },
});

const mss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

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

function PhaseBody({ phase: p, live, names }: { phase: Phase; live: boolean; names: Map<string, string> }) {
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
        <span {...stylex.props(styles.line)}>
          Followed the skill{p.skills.length > 1 ? "s" : ""}
          {p.skills.map((s) => (
            <span key={s} data-testid="act-skill" {...stylex.props(styles.skill)}>
              {s}
            </span>
          ))}
        </span>
      )}
      {p.kind === "prepare" && others.length > 0 && (
        <span {...stylex.props(styles.line)}>{sentence(others.map((a) => a.text))}</span>
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
        <ol {...stylex.props(styles.plan)}>
          {p.planned.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ol>
      )}
      {p.kind === "write" && last && (
        <span {...stylex.props(styles.line)}>
          Last written: {last.summary ? `“${last.summary}”` : last.id}
          {p.written.some((w) => w.saves > 1) &&
            `; ${plural(p.written.filter((w) => w.saves > 1).length, "test")} written more than once`}
          .
        </span>
      )}
      {p.verdicts.length > 0 && (
        <ul aria-label="Check verdicts" {...stylex.props(styles.verdicts)}>
          {p.verdicts.map((v) => {
            const { label, tone, kind } = verdictOf(v);
            return (
              <li key={v.id} data-verdict={kind} {...stylex.props(styles.verdict)}>
                <span {...stylex.props(styles.id)}>{v.id}</span>
                <span {...stylex.props(styles.name)}>{names.get(v.id) ?? ""}</span>
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
            {...stylex.props(styles.line, a.level === "warn" ? styles.warn : styles.error)}
          >
            {a.text}
          </span>
        ))}
      {said && p.kind !== "end" && (
        <p data-testid="act-said" {...stylex.props(styles.said)}>
          <Icon name="claude" size="sm" />
          {said}
        </p>
      )}
      {p.kind !== "end" && steps > 1 && (
        <div {...stylex.props(styles.toggles)}>
          <Button
            variant="quiet"
            size="sm"
            label={`${open ? "Hide" : "Show"} the ${steps} actions`}
            expanded={open}
            onClick={() => setOpen((o) => !o)}
          />
          {open && p.lookups.length > 0 && (
            <Button
              variant="quiet"
              size="sm"
              label={inOrder ? "Grouped" : "In order, one per line"}
              onClick={() => setInOrder((o) => !o)}
            />
          )}
        </div>
      )}
      {open && grouped && <Lookups p={p} />}
      {open && !grouped && (
        <ol {...stylex.props(styles.steps)}>
          {p.acts.map((a, i) => (
            <li
              key={i}
              data-level={a.level}
              {...stylex.props(a.level === "warn" && styles.warn, a.level === "error" && styles.error)}
            >
              <span {...stylex.props(styles.at)}>{clock(a.at)}</span>
              {a.text}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ponytail: « What Claude did » — a Claude run folded into phases (got ready, read, planned, wrote, checked), each
// with what it read and where, what it wrote and the check's verdicts; the raw log on demand
export function ClaudeActivity({
  events,
  running,
  now,
  label = "What Claude did",
  model,
  effort,
}: {
  events: JobEvent[];
  running: boolean;
  now: number;
  label?: string;
  /** the run's model and effort, from the job's input: they open the head's line */
  model?: string;
  effort?: string;
}) {
  const [shown, setShown] = useState(true);
  const [raw, setRaw] = useState(false);
  const phases = activityOf(events);
  const head = runLine(events, model, effort);
  const planned = phases.reduce((n, p) => n + p.planned.length, 0);
  const names = new Map(phases.flatMap((p) => p.written.filter((w) => w.summary).map((w) => [w.id, w.summary])));
  const items: TimelineItem[] = phases.map((p, i) => {
    const live = running && i === phases.length - 1;
    const warned = p.acts.some((a) => a.level === "warn");
    return {
      key: `${p.kind}-${p.from}`,
      state: live ? "running" : p.failed ? "failed" : "done",
      title: (
        <h3 {...stylex.props(styles.heading)}>
          {title(
            p,
            live,
            planned,
            phases.slice(0, i).some((x) => x.kind === "check"),
          )}
        </h3>
      ),
      time: `${clock(p.from)}${p.kind !== "end" ? `, ${lasted(p.from, live ? new Date(now).toISOString() : p.to)}` : ""}`,
      note: warned ? <Icon name="alert-triangle" size="sm" label="Warnings" /> : undefined,
      children: <PhaseBody phase={p} live={live} names={names} />,
    };
  });
  return (
    <div {...stylex.props(styles.card)}>
      <Disclosure
        summary={label}
        open={shown}
        onOpenChange={setShown}
        meta={
          [head, !shown && phases.length > 0 ? plural(phases.length, "phase") : ""].filter(Boolean).join(" · ") ||
          undefined
        }
      >
        {!phases.length && (
          <p {...stylex.props(styles.muted)}>
            {running ? "Claude is starting." : "Nothing was recorded for this run."}
          </p>
        )}
        {phases.length > 0 && <Timeline label="Phases" tone="claude" items={items} />}
        <span>
          <Button
            variant="quiet"
            size="sm"
            icon="terminal"
            label={`${raw ? "Hide" : "Show"} the raw log (${plural(events.length, "event")})`}
            expanded={raw}
            onClick={() => setRaw((r) => !r)}
          />
        </span>
        {raw && <JobLog events={events} label="Raw log" />}
      </Disclosure>
    </div>
  );
}
