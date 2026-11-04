import { useRef } from "react";
import type { Step } from "../../../../core/types.ts";

// ponytail: a step card edits its step by identity, not by position — an Undo that lands after a move, or a toast that
// outlived a drag, still finds the step it was made for. Identity is the step object; an edit hands its uid on to the
// new object, and a test read again with as many steps keeps its cards (and the caret in them) by position
export function useStepUids() {
  const u = useRef({ map: new WeakMap<Step, number>(), n: 0, last: [] as Step[] });

  const uidOf = (s: Step): number => {
    const r = u.current;
    let k = r.map.get(s);
    if (k === undefined) {
      k = ++r.n;
      r.map.set(s, k);
    }
    return k;
  };

  const keep = (from: Step, to: Step) => u.current.map.set(to, uidOf(from));

  // called with the steps on screen at each render
  const carry = (steps: Step[]) => {
    const r = u.current;
    if (steps.length === r.last.length)
      steps.forEach((s, i) => {
        if (!r.map.has(s) && r.last[i]) r.map.set(s, uidOf(r.last[i]));
      });
    r.last = steps;
  };

  return { uidOf, keep, carry };
}
