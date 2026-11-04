import { useEffect, useState } from "react";

// ponytail: the clock of a duration on screen (a job's elapsed time) — it ticks only while something shows it
export function useNow(everyMs = 1000, on = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [everyMs, on]);
  return now;
}
