import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import type { Job, JobProcess } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { List } from "../../components/ui/List.tsx";
import type { ListItemProps } from "../../components/ui/ListItem.tsx";
import { Progress } from "../../components/ui/Progress.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import {
  childSummary,
  clock,
  duration,
  failedStep,
  isRunning,
  type JobNode,
  kindLabel,
  percent,
  problemText,
  processLabel,
  resultLine,
  sections,
  subjectLabel,
  subtree,
} from "../../lib/jobs.ts";
import { color, container, size, space } from "../../styles/tokens.stylex.ts";
import { JobState, KindTile } from "./JobState.tsx";
import { CLAUDE_KINDS } from "./kinds.ts";

const styles = stylex.create({
  trail: { display: "flex", alignItems: "center", gap: space.s4 },
  prog: {
    display: { default: "block", [container.paneCompact]: "none" },
    width: `calc(${space.s11} + ${space.s5})`,
    color: color.textMuted,
    textAlign: "end",
  },
  bar: { alignSelf: "center" },
  time: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    minWidth: size.controlLg,
    color: color.textMuted,
  },
  mono: { color: color.text },
  at: { display: { default: "inline", [container.paneCompact]: "none" } },
  meta: { display: "inline-flex", flexWrap: "wrap", columnGap: space.s2 },
  cause: { color: color.text },
  part: { display: "inline-flex", gap: space.s2 },
});

const CAUSE: Record<string, string> = {
  "after-failure": "After the failure",
  "follow-up": "Follow-up",
  retry: "Run again",
};

type Row =
  | { key: string; kind: "job"; node: JobNode; depth: number; repeat?: boolean }
  | { key: string; kind: "process"; p: JobProcess; job: Job; depth: number };

export type ListCtx = {
  byId: Map<string, Job>;
  activeId: string;
  now: number;
  isOpen(n: JobNode): boolean;
  toggle(id: string, open: boolean): void;
  pick(id: string): void;
  cancel(id: string): void;
};

function inside(n: JobNode): string {
  const k = n.children.length + n.after.length;
  const p = n.job.processes?.length ?? 0;
  return [k ? plural(k, "job") : "", p === 1 ? "1 process" : p ? `${p} processes` : ""].filter(Boolean).join(" · ");
}

function subOf(job: Job, n: JobNode): string {
  if (job.status === "running") {
    const s = job.steps?.find((x) => x.status === "running");
    return job.steps?.length && s
      ? `Step ${job.steps.indexOf(s) + 1} of ${job.steps.length} · ${s.label}`
      : (job.message ?? "");
  }
  if (job.status === "failed" && !job.interrupted) return failedStep(job)?.label ?? problemText(job).what;
  const rest = resultLine(job).split(" · ").slice(1).join(" · ");
  return rest || childSummary(n);
}

const kids = (n: JobNode) => n.children.length + n.after.length + n.repeats.length + (n.job.processes?.length ?? 0);

function flatten(n: JobNode, depth: number, c: ListCtx, out: Row[]): void {
  out.push({ key: n.job.id, kind: "job", node: n, depth });
  if (!kids(n) || !c.isOpen(n)) return;
  for (const x of n.children) flatten(x, depth + 1, c, out);
  for (const p of [...(n.job.processes ?? [])].sort((a, b) => a.startedAt.localeCompare(b.startedAt)))
    out.push({ key: `${n.job.id}/${p.id}`, kind: "process", p, job: n.job, depth: depth + 1 });
  for (const x of n.after) flatten(x, depth + 1, c, out);
  for (const j of n.repeats)
    out.push({ key: j.id, kind: "job", node: { job: j, children: [], after: [], repeats: [] }, depth: depth + 1 });
}

const claudeRun = (job: Job) =>
  CLAUDE_KINDS.includes(job.kind) ||
  job.kind === "generate" ||
  (job.processes ?? []).some((p) => !p.endedAt && p.label.startsWith("Claude"));

function Progressed({ job }: { job: Job }) {
  const steps = job.steps ?? [];
  if (job.status === "running") {
    const multi = steps.length > 1;
    const done = steps.filter((s) => s.status === "done").length;
    const value = multi ? Math.round((done / steps.length) * 100) : percent(job);
    return (
      <span {...stylex.props(styles.prog, styles.bar)}>
        <Progress
          label={multi ? `${kindLabel(job.kind)} steps` : `${kindLabel(job.kind)} progress`}
          value={value}
          tone={claudeRun(job) ? "claude" : "accent"}
        />
      </span>
    );
  }
  return (
    <span {...stylex.props(type.small, type.tabular, styles.prog)}>
      {job.progress?.total ? `${job.progress.done} of ${job.progress.total}` : ""}
    </span>
  );
}

function trail(prog: ReactNode, state: ReactNode, time: string, at?: string): ReactNode {
  return (
    <span {...stylex.props(styles.trail)}>
      {prog}
      {state}
      <span {...stylex.props(type.small, styles.time)}>
        <span {...stylex.props(type.code, styles.mono)}>{time}</span>
        {at && <span {...stylex.props(styles.at)}>{at}</span>}
      </span>
    </span>
  );
}

function jobItem(r: Extract<Row, { kind: "job" }>, c: ListCtx): ListItemProps {
  const { node: n, depth } = r;
  const job = n.job;
  const open = kids(n) > 0 ? c.isOpen(n) : null;
  const cause = job.cause && depth > 0 ? CAUSE[job.cause.why] : "";
  const repeats = n.repeats.length;
  const sub = subOf(job, n);
  const meta = [subjectLabel(job, c.byId), repeats ? `${repeats + 1} runs, the last shown` : inside(n), sub].filter(
    Boolean,
  );
  return {
    lead: <KindTile kind={job.kind} size={depth > 0 ? "sm" : "md"} />,
    title: kindLabel(job.kind),
    badges: repeats > 0 && <Badge label={`×${repeats + 1}`} size="sm" />,
    meta: (
      <span {...stylex.props(styles.meta)}>
        {cause && <span {...stylex.props(type.medium, styles.cause)}>{cause}</span>}
        {meta.map((m, i) => (
          <span key={m} {...stylex.props(styles.part)}>
            {(i > 0 || cause) && <span aria-hidden="true">·</span>}
            {m}
          </span>
        ))}
      </span>
    ),
    trail: trail(
      <Progressed job={job} />,
      <JobState job={job} now={c.now} timed={false} />,
      duration(job, c.now),
      clock(job.startedAt).slice(0, 5),
    ),
    actions:
      job.status === "running" ? (
        <Button
          variant="quiet"
          size="xs"
          icon="stop"
          iconOnly
          label={`Cancel ${kindLabel(job.kind)}`}
          onClick={() => c.cancel(job.id)}
        />
      ) : undefined,
    depth,
    expanded: open,
  };
}

function processItem(r: Extract<Row, { kind: "process" }>, c: ListCtx): ListItemProps {
  const { p, depth } = r;
  const running = !p.endedAt;
  const ok = p.exit === 0;
  return {
    lead: <KindTile kind={p.label.startsWith("Claude") ? "claude-process" : "process"} size="sm" />,
    title: processLabel(p.label),
    meta: `Process · ${p.command}${p.pid ? ` · pid ${p.pid}` : ""}`,
    trail: trail(
      <span {...stylex.props(styles.prog)} />,
      running ? (
        <Badge label="Running" tone="info" busy size="sm" />
      ) : (
        <Badge
          label={ok ? "Ended" : `Ended with code ${p.exit ?? "?"}`}
          tone={ok ? "success" : "danger"}
          icon={ok ? "check" : "x-circle"}
          size="sm"
        />
      ),
      duration({ startedAt: p.startedAt, endedAt: p.endedAt }, c.now),
    ),
    depth,
    expanded: null,
  };
}

// ponytail: the jobs as a tree — running first, then a section per day; a job opens on what it ran (jobs inside,
// processes, jobs started after it, repeats)
export function JobList({ shown, c, empty }: { shown: JobNode[]; c: ListCtx; empty?: ReactNode }) {
  const rows: Row[] = [];
  const groups = sections(shown, c.now).map((s) => {
    const from = rows.length;
    for (const n of s.nodes) flatten(n, 0, c, rows);
    return { label: s.title, meta: String(s.nodes.length), keys: rows.slice(from).map((r) => r.key) };
  });
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (
    <List<Row>
      label="Jobs"
      tree
      density="two-line"
      items={rows}
      getKey={(r) => r.key}
      groups={groups}
      selected={c.activeId}
      empty={empty}
      renderItem={(r) => (r.kind === "job" ? jobItem(r, c) : processItem(r, c))}
      onSelect={(k) => {
        const r = byKey.get(k);
        if (r) c.pick(r.kind === "job" ? r.node.job.id : r.job.id);
      }}
      onToggle={(k) => {
        const r = byKey.get(k);
        if (r?.kind === "job") c.toggle(r.node.job.id, !c.isOpen(r.node));
      }}
    />
  );
}

export const openByDefault = (n: JobNode, activeId: string) =>
  isRunning(n) ||
  (n.job.status === "failed" && n.after.length > 0) ||
  (activeId !== n.job.id && subtree(n).some((j) => j.id === activeId));
