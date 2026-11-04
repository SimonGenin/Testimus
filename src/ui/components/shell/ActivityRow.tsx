import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import { useJobEvents } from "../../lib/data/events.ts";
import { kindLabel } from "../../lib/jobs.ts";
import { kindIcon } from "../../screens/jobs/kinds.ts";
import { border, color, size, space } from "../../styles/tokens.stylex.ts";
import type { IconName } from "../ui/Icon.tsx";
import { Progress } from "../ui/Progress.tsx";
import { Tile } from "../ui/Tile.tsx";
import { type } from "../ui/type.ts";

export type ActivityItem = {
  key: string;
  id?: string;
  kind: string;
  label: string;
  message?: string;
  startedAt: string;
  progress?: { done: number; total: number };
};

type Tone = "doc" | "claude" | "plain";

// ponytail: the icon is the Jobs screen's (one table, kindIcon); here only the tile's tint — and work the page waits
// on, not a job, turns
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
  "actions.triage": "claude",
  "gen-bench": "claude",
};

const TILE = { doc: "accent", claude: "claude", plain: "neutral" } as const;

const kindOf = (kind: string): [IconName, Tone] => [
  kind === "jira" ? "spinner" : kindIcon(kind),
  TONE[kind] ?? "plain",
];

export function elapsed(startedAt: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(startedAt)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const styles = stylex.create({
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    listStyle: "none",
    borderTopWidth: border.width,
    borderTopStyle: { default: "solid", ":first-child": "none" },
    borderColor: color.border,
  },
  lead: { display: "flex", flex: "none" },
  body: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s2 },
  time: {
    flex: "none",
    display: "inline-flex",
    alignItems: "center",
    minHeight: size.controlXs,
    color: color.textMuted,
    whiteSpace: "nowrap",
  },
  label: {
    color: color.text,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

// ponytail: one piece of running work — « its kind · its subject », its progress as the job says it, its time on the
// right, and the action that stops it (a job only: a Jira load the page waits on has none, and says so)
export function ActivityRow({ item, now, action }: { item: ActivityItem; now: number; action?: ReactNode }) {
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
  const message = live.message ?? item.message;
  const job = !!item.id;
  const detail =
    [message, sized ? `${progress.done}/${progress.total}` : ""].filter(Boolean).join(" · ") ||
    (job ? "" : "Not a job — it cannot be cancelled");
  const kind = job ? kindLabel(item.kind) : "";
  const title = kind && item.label && item.label !== item.kind ? `${kind} · ${item.label}` : kind || item.label;
  return (
    <li data-kind={tone} {...stylex.props(styles.row)}>
      <span title={item.kind} {...stylex.props(styles.lead)}>
        <Tile icon={icon} tone={TILE[tone]} />
      </span>
      <div {...stylex.props(styles.body)}>
        <span title={title} {...stylex.props(type.compact, styles.label)}>
          {title}
        </span>
        <Progress
          label={item.label}
          value={sized ? Math.min(100, (progress.done / progress.total) * 100) : null}
          tone={tone === "claude" ? "claude" : "accent"}
          detail={detail || undefined}
        />
      </div>
      <span data-testid="elapsed" {...stylex.props(type.code, type.tabular, styles.time)}>
        {elapsed(item.startedAt, now)}
      </span>
      {action}
    </li>
  );
}
