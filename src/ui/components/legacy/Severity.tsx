import type { ReactNode } from "react";
import type { Severity as Level } from "../../../core/types.ts";
import { cx } from "../../lib/format.ts";
import { Icon, type IconName } from "./Icon.tsx";

export type SeverityTone = Level | "ok" | "stale";

const LOOK: Record<SeverityTone, { cls: string; icon: IconName; word: string }> = {
  error: { cls: "s-err", icon: "error", word: "Error" },
  warning: { cls: "s-warn", icon: "warning", word: "Warning" },
  info: { cls: "s-info", icon: "info", word: "Info" },
  ok: { cls: "s-ok", icon: "check", word: "No findings" },
  stale: { cls: "s-stale", icon: "clock", word: "Out of date" },
};

export function Severity({ tone, children }: { tone: SeverityTone; children?: ReactNode }) {
  const l = LOOK[tone];
  return (
    <span className={cx("sev", l.cls)}>
      <Icon name={l.icon} />
      {children ?? l.word}
    </span>
  );
}
