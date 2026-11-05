import { useEffect, useReducer } from "react";
import { desktop, readAlwaysOnTop, setAlwaysOnTop } from "../../lib/desktop.ts";
import { Button } from "../ui/Button.tsx";

// ponytail: the pin of the top bar, beside the palette, on every screen; the choice is kept by lib/desktop (in the
// preferences), which tells the window and every pin and switch that shows it
export function OnTopToggle() {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    window.addEventListener("testimus:on-top", redraw);
    return () => window.removeEventListener("testimus:on-top", redraw);
  }, []);
  if (!desktop()) return null;
  const on = readAlwaysOnTop();
  return (
    <Button
      variant="quiet"
      icon="pin"
      iconOnly
      pressed={on}
      label="Always on top"
      onClick={() => void setAlwaysOnTop(!on)}
    />
  );
}
