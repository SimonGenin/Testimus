import { useEffect, useState } from "react";

// ponytail: the clock of a running counter (the seconds of a Claude run), ticking only while it is on
export function useNow(on: boolean, ms = 100): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return on ? now : Date.now();
}
