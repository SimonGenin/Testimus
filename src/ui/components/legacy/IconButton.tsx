import type { ComponentProps } from "react";
import { cx } from "../../lib/format.ts";
import { Icon, type IconName } from "./Icon.tsx";

type IconButtonProps = Omit<ComponentProps<"button">, "type" | "children"> & {
  icon: IconName;
  label: string;
  size?: "sm" | "md";
};

export function IconButton({ icon, label, size = "sm", className, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      className={cx("btn btn-quiet iconbtn", size === "sm" && "btn-sm", className)}
      aria-label={label}
      title={rest.title ?? label}
      {...rest}
    >
      <Icon name={icon} />
    </button>
  );
}
