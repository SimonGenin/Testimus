import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import { useJobEvents } from "../../lib/data/events.ts";
import { kindLabel } from "../../lib/jobs.ts";
import { nameTests, useTestNames } from "../../lib/labels.ts";
import { border, color, size, space } from "../../styles/tokens.stylex.ts";
import { kindIcon } from "../jobs/kinds.ts";
import { Button } from "../ui/Button.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Progress } from "../ui/Progress.tsx";
import { type } from "../ui/type.ts";

export type ActivityItem = {
  key: string;
  id?: string;
  kind: string;
  label: string;
  message?: string;
  startedAt: string;
  progress?: { done: number; total: number };
  /** a job that failed: when it ended (its time stops there) and why, in its first line */
  endedAt?: string;
  error?: string;
  /** a running job that has been silent: « Last sign 4 min ago », « May be stuck · … » */
  quiet?: { text: string; stuck: boolean };
};

type Tone = "doc" | "claude" | "plain";

// ponytail: the icon is the job panel's (one table, kindIcon) — a Claude run is Claude's spark, and work the page
// waits on, not a job, turns; the tone gives the bar its colour
const TONE: Record<string, Tone> = {
  "docs.add": "doc",
  "docs.convert": "doc",
  "rag-index": "doc",
  "describe-figures": "claude",
  generate: "claude",
  fix: "claude",
  check: "claude",
  columns: "claude",
  claude: "claude",
  chat: "claude",
  learn: "claude",
  "actions.triage": "claude",
  "gen-bench": "claude",
};

const kindOf = (kind: string): [IconName, Tone] => {
  const tone = TONE[kind] ?? "plain";
  return [kind === "jira" ? "spinner" : tone === "claude" ? "claude" : kindIcon(kind), tone];
};

export function elapsed(startedAt: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const styles = stylex.create({
  row: {
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    paddingBlock: space.s4,
    paddingInline: space.s5,
    listStyle: "none",
    borderTopWidth: border.width,
    borderTopStyle: { default: "solid", ":first-child": "none" },
    borderColor: color.border,
  },
  top: { display: "flex", alignItems: "flex-start", gap: space.s3 },
  lead: {
    display: "inline-flex",
    flex: "none",
    alignItems: "center",
    minHeight: size.controlXs,
    color: color.textMuted,
  },
  claude: { color: color.claudeText },
  body: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s1 },
  time: {
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    minHeight: size.controlXs,
    color: color.textMuted,
    whiteSpace: "nowrap",
  },
  label: {
    display: "flex",
    alignItems: "center",
    minHeight: size.controlXs,
    color: color.text,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  detail: { color: color.textMuted },
  error: { color: color.danger },
  quiet: { color: color.warning },
  bar: { marginInlineStart: `calc(${size.iconMd} + ${space.s3})` },
});

// ponytail: one piece of running work — its icon, « its kind · its subject », what it does now under it, its time and
// the action that stops it on the right (a job only: a Jira load the page waits on has none, and says so), then its
// progress as the job says it across the row; a job's title opens it in the job panel
export function ActivityRow({
  item,
  now,
  action,
  onOpen,
  children,
}: {
  item: ActivityItem;
  now: number;
  action?: ReactNode;
  onOpen?: () => void;
  /** under the bar: the jobs running inside this one (a folder import's conversions) */
  children?: ReactNode;
}) {
  const [live, setLive] = useState<{ message?: string; progress?: { done: number; total: number } }>({});
  useJobEvents(item.id, (e) => {
    if (e.type !== "progress") return;
    setLive((cur) => ({
      message: e.message,
      progress: e.total !== undefined ? { done: e.done ?? 0, total: e.total } : cur.progress,
    }));
  });
  const [icon, tone] = kindOf(item.kind);
  const progress = live.progress ?? item.progress;
  const sized = !!progress && progress.total > 0;
  const names = useTestNames();
  const message = nameTests(live.message ?? item.message ?? "", names);
  const job = !!item.id;
  const detail =
    item.error ??
    ([message, sized ? `${progress.done}/${progress.total}` : ""].filter(Boolean).join(" · ") ||
      (job ? "" : "Not a job — it cannot be cancelled"));
  const kind = job ? kindLabel(item.kind) : "";
  const title = kind && item.label && item.label !== item.kind ? `${kind} · ${item.label}` : kind || item.label;
  return (
    <li data-kind={tone} {...stylex.props(styles.row)}>
      <div {...stylex.props(styles.top)}>
        <span title={item.kind} {...stylex.props(styles.lead, tone === "claude" && styles.claude)}>
          <Icon name={icon} />
        </span>
        <div {...stylex.props(styles.body)}>
          <span title={title} {...stylex.props(type.compact, styles.label)}>
            {onOpen ? <Button variant="link" label={title} onClick={onOpen} /> : title}
          </span>
          {detail && <span {...stylex.props(type.small, styles.detail, !!item.error && styles.error)}>{detail}</span>}
          {item.quiet && (
            <span {...stylex.props(type.small, item.quiet.stuck ? styles.error : styles.quiet)}>{item.quiet.text}</span>
          )}
        </div>
        <span data-testid="elapsed" {...stylex.props(type.code, type.tabular, styles.time)}>
          {elapsed(item.startedAt, item.endedAt ? Date.parse(item.endedAt) : now)}
        </span>
        {action}
      </div>
      {job && !item.endedAt && (
        <div {...stylex.props(styles.bar)}>
          <Progress
            label={item.label}
            value={sized ? Math.min(100, (progress.done / progress.total) * 100) : null}
            tone={tone === "claude" ? "claude" : "accent"}
          />
        </div>
      )}
      {children && <div {...stylex.props(styles.bar)}>{children}</div>}
    </li>
  );
}
