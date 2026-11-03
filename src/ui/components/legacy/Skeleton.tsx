import type { CSSProperties } from "react";
import { cx } from "../../lib/format.ts";

// ponytail: one bar at the real size of what it stands for — a loading state is the real thing's own
// rhythm drawn out of these, so nothing moves when the content lands. Never a centred spinner.
export function Skeleton({
  w,
  h = 10,
  r,
  className,
  style,
}: {
  w?: number | string;
  h?: number | string;
  r?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cx("sk", className)}
      aria-hidden="true"
      style={{
        width: typeof w === "number" ? `${w}px` : w,
        height: typeof h === "number" ? `${h}px` : h,
        borderRadius: r,
        ...style,
      }}
    />
  );
}
