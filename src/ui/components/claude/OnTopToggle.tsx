import { useEffect, useState } from "react";
import { desktop, readAlwaysOnTop, setAlwaysOnTop } from "../../lib/desktop.ts";
import { cx } from "../../lib/format.ts";
import { Icon } from "../ui/index.ts";

export function OnTopToggle({ className }: { className?: string }) {
  const [on, setOn] = useState(readAlwaysOnTop);
  useEffect(() => {
    const onChange = (e: Event) => setOn((e as CustomEvent<boolean>).detail === true);
    window.addEventListener("testimus:on-top", onChange);
    return () => window.removeEventListener("testimus:on-top", onChange);
  }, []);
  if (!desktop()) return null;
  return (
    <button
      type="button"
      className={cx("btn btn-quiet btn-sm iconbtn ontop", on && "ontop-on", className)}
      aria-pressed={on}
      aria-label="Always on top"
      title={on ? "Always on top — click to let other windows cover Testimus" : "Always on top"}
      onClick={() => void setAlwaysOnTop(!on)}
    >
      <Icon name="pin" />
    </button>
  );
}
