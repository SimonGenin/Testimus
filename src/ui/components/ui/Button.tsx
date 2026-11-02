import type { ComponentProps } from "react";
import { cx } from "../../lib/format.ts";
import { Icon, type IconName } from "./Icon.tsx";
import { Kbd } from "./Kbd.tsx";

type ButtonProps = Omit<ComponentProps<"button">, "type"> & {
  tone?: "primary" | "secondary" | "quiet";
  size?: "sm" | "md";
  icon?: IconName;
  kbd?: string;
};

export function Button({ tone = "secondary", size = "md", icon, kbd, className, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        "btn",
        tone === "primary" && "btn-primary",
        tone === "quiet" && "btn-quiet",
        size === "sm" && "btn-sm",
        className,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
      {kbd && <Kbd>{kbd}</Kbd>}
    </button>
  );
}
