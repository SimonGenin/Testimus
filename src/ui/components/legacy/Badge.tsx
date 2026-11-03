import type { ComponentProps } from "react";
import { cx } from "../../lib/format.ts";
import { Icon, type IconName } from "./Icon.tsx";

export type BadgeTone = "neutral" | "info" | "warn" | "ok" | "err" | "line" | "claude";

export function Badge({
  tone = "neutral",
  icon,
  small,
  children,
  className,
  ...rest
}: ComponentProps<"span"> & { tone?: BadgeTone; icon?: IconName; small?: boolean }) {
  return (
    <span {...rest} className={cx("badge", `b-${tone}`, small && "b-sm", className)}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}
