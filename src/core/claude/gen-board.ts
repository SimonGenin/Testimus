import type { GenTestProgress } from "../types.ts";

// ponytail: which tests a generation is writing, said in its job's progress (the `gen` of a progress event) so the
// Generate page opens the test Claude is on — read from the run's own tool calls, as « Writing <id> » always was. A
// lane is one Claude run: the whole request, or one planned test; wrote() says whether the board moved, and the
// progress line the caller sends next carries it

export type Lane = { wrote(id: string): boolean; end(): void };

export function genBoard(publish: (tests: GenTestProgress[]) => void) {
  const tests: GenTestProgress[] = [];
  const say = () => publish(tests.map((t) => ({ ...t })));
  const lane = (own: number[]): Lane => ({
    wrote(id) {
      let at = own.find((k) => tests[k].id === id);
      if (at !== undefined && tests[at].state === "writing") return false;
      if (at === undefined) at = own.find((k) => tests[k].id === undefined);
      if (at === undefined) {
        at = tests.push({ id, state: "writing" }) - 1;
        own.push(at);
      }
      for (const k of own) if (tests[k].state === "writing") tests[k].state = "written";
      tests[at] = { ...tests[at], id, state: "writing" };
      return true;
    },
    end() {
      for (const k of own)
        if (tests[k].state !== "written") tests[k].state = tests[k].id === undefined ? "missed" : "written";
      say();
    },
  });
  return {
    tests: () => tests.map((t) => ({ ...t })),
    plan(summaries: string[]): number[] {
      const at = summaries.map((summary) => tests.push({ summary, state: "waiting" }) - 1);
      if (at.length) say();
      return at;
    },
    run(): Lane {
      return lane([]);
    },
    start(k: number): Lane {
      tests[k].state = "writing";
      say();
      return lane([k]);
    },
  };
}
