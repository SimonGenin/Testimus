import { useEffect, useRef } from "react";
import { events } from "../api.ts";

export const touches = (paths: string[], prefixes: string[]) =>
  paths.filter((p) => prefixes.some((x) => p === x || p.startsWith(x)));

// ponytail: a job ends by naming the project files it changed (relative, with /) — a view that shows one of them
// reads it again, whichever screen or dock started the job; "" names every file
export function useChanged(prefixes: string[], reload: (paths: string[]) => void): void {
  const latest = useRef(reload);
  latest.current = reload;
  const key = JSON.stringify(prefixes);
  useEffect(() => {
    const list = JSON.parse(key) as string[];
    return events((e) => {
      if (e.type !== "changed") return;
      const hit = touches(e.paths, list);
      if (hit.length) latest.current(hit);
    });
  }, [key]);
}
