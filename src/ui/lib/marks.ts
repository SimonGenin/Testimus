// ponytail: a step is « added » only when the test had fewer steps before the run; with no known
// before-count (the test was not open when the run started) every changed step is just « changed »
export const addedSteps = (changed: number[], before: number | null | undefined): Set<number> =>
  new Set(before == null ? [] : changed.filter((n) => n > before));
