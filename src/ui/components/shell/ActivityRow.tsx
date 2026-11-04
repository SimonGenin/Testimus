import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import { useJobEvents } from "../../lib/data/events.ts";
import { border, color, fontSize, lineHeight, radius, size, space } from "../../styles/tokens.stylex.ts";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Progress } from "../ui/Progress.tsx";

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

const KIND: Record<string, [IconName, Tone]> = {
  "docs.add": ["documents", "doc"],
  "docs.convert": ["documents", "doc"],
  "rag-index": ["documents", "doc"],
  "describe-figures": ["image", "claude"],
  generate: ["generate", "claude"],
  fix: ["claude", "claude"],
  check: ["claude", "claude"],
  columns: ["claude", "claude"],
  claude: ["claude", "claude"],
  chat: ["claude", "claude"],
  "actions.triage": ["claude", "claude"],
  "gen-bench": ["claude", "claude"],
  "rag-eval": ["search", "plain"],
  "models-measure": ["search", "plain"],
  pull: ["download", "plain"],
  push: ["push", "plain"],
  jira: ["folder", "plain"],
};

export const kindOf = (kind: string): [IconName, Tone] =>
  KIND[kind] ?? (kind.startsWith("models") ? ["download", "plain"] : ["jobs", "plain"]);

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
  tile: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flex: "none",
    width: size.controlMd,
    height: size.controlMd,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    color: color.textMuted,
  },
  doc: { backgroundColor: color.accentSubtle, color: color.accentText },
  claude: { backgroundColor: color.claudeSubtle, color: color.claudeText },
  plain: {},
  body: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s2 },
  label: {
    color: color.text,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

// ponytail: one piece of running work — its kind, its subject, its progress as the job says it, its time, and the
// action that stops it (a job only: a Jira load the page waits on has none)
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
  const detail = [message, sized ? `${progress.done}/${progress.total}` : "", elapsed(item.startedAt, now)]
    .filter(Boolean)
    .join(" · ");
  return (
    <li data-kind={tone} {...stylex.props(styles.row)}>
      <span title={item.kind} {...stylex.props(styles.tile, styles[tone])}>
        <Icon name={icon} />
      </span>
      <div {...stylex.props(styles.body)}>
        <span {...stylex.props(styles.label)}>{item.label}</span>
        <Progress
          label={item.label}
          value={sized ? Math.min(100, (progress.done / progress.total) * 100) : null}
          tone={tone === "claude" ? "claude" : "accent"}
          detail={detail}
        />
      </div>
      {action}
    </li>
  );
}
