import type { ActionTarget } from "../../../core/types.ts";
import type { Action } from "../../lib/actions.ts";
import { useApp } from "../../lib/app.ts";
import { key, useCommand, useRead } from "../../lib/data/query.ts";

export type GenFixes = {
  /** the fixes proposed on each test of the generation (open, running, or open again after a run that failed) */
  of: (testId: string) => Action[];
  /** the tests that have one, in the core's order */
  tests: string[];
  count: number;
  /** what is proposed on the generation itself: the categories of tests not written */
  general: Action[];
  run: (a: Action) => void;
  dismiss: (a: Action) => void;
};

const NONE: Action[] = [];

// ponytail: the Claude actions the core left for a generation (actions.list by generation), sorted out once for the
// screen: a test's fixes go on its card, the generation's own beside the ask; each runs in the dock like any action
export function useGenFixes(generation: string | null): GenFixes {
  const app = useApp();
  const view: ActionTarget | undefined = generation ? { kind: "generation", id: generation } : undefined;
  const input = { generation: generation ?? "", view };
  const read = useRead("actions.list", input, { enabled: !!generation });
  const dismiss = useCommand("actions.dismiss", {
    invalidates: [["actions.list"]],
    optimistic: (c, i) => {
      const k = key("actions.list", input);
      const before = c.getQueryData<Action[]>(k);
      c.setQueryData<Action[]>(
        k,
        before?.filter((a) => a.id !== i.id),
      );
      return () => c.setQueryData(k, before);
    },
  });
  const all = ((read.data ?? NONE) as Action[]).filter((a) => a.state === "open" || a.state === "running");
  const onTests = all.filter((a) => a.target.kind === "test");
  const tests = [...new Set(onTests.map((a) => a.target.id))];
  return {
    of: (testId) => onTests.filter((a) => a.target.id === testId),
    tests,
    count: onTests.length,
    general: all.filter((a) => a.target.kind !== "test"),
    run: (a) =>
      app.runInDock({
        name: "actions.run",
        input: { id: a.id },
        label: a.title,
        testId: "",
      }),
    dismiss: (a) => dismiss.mutate({ id: a.id }),
  };
}
