import { useEffect, useState } from "react";
import type { ClaudeRun } from "../../lib/app.ts";
import { addedSteps } from "../../lib/marks.ts";
import type { Marks } from "./ReviewBanners.tsx";
import { firstFinding, type Opened } from "./sources.ts";
import type { Loaded } from "./useReview.ts";

export type Selection = Opened | null;

type View = {
  id: string;
  folded: Set<number> | null;
  activeStep: number;
  sel: Selection;
  editing: boolean;
  fixOpen: boolean;
  marks: Marks | null;
};

const fresh = (id: string): View => ({
  id,
  folded: null,
  activeStep: -1,
  sel: null,
  editing: false,
  fixOpen: false,
  marks: null,
});

// ponytail: how the reviewer looks at the open test (folds, the step and source in focus, the editor, the To fix
// note, the steps Claude's last run changed) — set afresh when another test opens, kept while the same one is read again
export function useReviewView(activeId: string, data: Loaded | null, lastRun: ClaudeRun | null) {
  const [view, setView] = useState<View>(() => fresh(activeId));
  let v = view;
  if (v.id !== activeId) {
    v = fresh(activeId);
    setView(v);
  }
  if (data && data.id === activeId && v.folded === null) {
    const fs = data.check?.findings ?? [];
    // ponytail: a step the check could not vouch for (unsupported, unjudged, passages never opened) stays open like one
    // with a finding
    const doubted = (data.check?.verdicts ?? []).filter((x) => x.verdict !== "supported" || x.opened === false);
    const quiet = data.test.steps
      .map((_, i) => i)
      .filter((i) => !fs.some((f) => f.step === i + 1) && !doubted.some((x) => x.step === i + 1));
    const first = firstFinding(data.test, data.check);
    v = {
      ...v,
      folded: new Set(data.check ? quiet : []),
      ...(first && !v.sel ? { sel: first, activeStep: first.step ? first.step - 1 : v.activeStep } : {}),
    };
    setView(v);
  }
  const patch = (p: Partial<View>) => setView((cur) => ({ ...cur, ...p }));

  // biome-ignore lint/correctness/useExhaustiveDependencies: a run is taken once, by its nonce
  useEffect(() => {
    if (!lastRun || !activeId) return;
    if (!lastRun.runId) {
      patch({ marks: null });
      return;
    }
    if (!lastRun.changedTests.includes(activeId) && !lastRun.changedSteps[activeId]) return;
    const before = data?.id === activeId ? data.test.steps.length : undefined;
    const steps = lastRun.changedSteps[activeId] ?? [];
    setView((cur) => ({
      ...cur,
      marks: { runId: lastRun.runId, steps: new Set(steps), added: addedSteps(steps, before) },
      folded: cur.folded && new Set([...cur.folded].filter((i) => !steps.includes(i + 1))),
    }));
  }, [lastRun?.nonce]);

  return {
    ...v,
    folded: v.folded ?? new Set<number>(),
    patch,
    fold: (i: number, f: boolean) =>
      setView((cur) => {
        const next = new Set(cur.folded ?? []);
        if (f) next.add(i);
        else next.delete(i);
        return { ...cur, folded: next, activeStep: f && i === cur.activeStep ? -1 : cur.activeStep };
      }),
    foldAll: (f: boolean, steps: number) =>
      patch({
        folded: f ? new Set(Array.from({ length: steps }, (_, i) => i)) : new Set(),
        ...(f ? { activeStep: -1 } : {}),
      }),
  };
}
