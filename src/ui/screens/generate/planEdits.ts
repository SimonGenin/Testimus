import type { CommandOutput } from "../../../core/commands/index.ts";

export type PlanShown = NonNullable<CommandOutput<"gen.show">["plan"]>;
export type Planned = PlanShown["tests"][number];
export type Question = PlanShown["questions"][number];

// ponytail: what the user does to a plan on Generate, as the plan it leaves — gen.planSet writes it whole

export const toggle = (tests: Planned[], k: number): Planned[] =>
  tests.map((t, i) => {
    if (i !== k) return t;
    const { off, ...rest } = t;
    return off ? rest : { ...rest, off: true };
  });

export const rename = (tests: Planned[], k: number, summary: string): Planned[] =>
  tests.map((t, i) => (i === k ? { ...t, summary: summary.trim() } : t));

export const retheme = (tests: Planned[], k: number, theme: string): Planned[] =>
  tests.map((t, i) => {
    if (i !== k) return t;
    const { theme: _old, ...rest } = t;
    return theme.trim() ? { ...rest, theme: theme.trim() } : rest;
  });

const join = (a: string, b: string) => [...new Set([a, b].map((x) => x.trim()).filter(Boolean))].join(", ");

// ponytail: two tests in one — the first keeps its place, its name and its theme, and reads both tests' sections
export function merge(tests: Planned[], into: number, other: number): Planned[] {
  const a = tests[into];
  const b = tests[other];
  const merged: Planned = {
    ...a,
    technique: join(a.technique, b.technique),
    sections: [...new Set([...a.sections, ...b.sections])],
  };
  return tests.flatMap((t, i) => (i === into ? [merged] : i === other ? [] : [t]));
}

export const themesOf = (tests: Planned[]): string[] => [...new Set(tests.map((t) => t.theme ?? "").filter(Boolean))];

// ponytail: « about 7 min » — the cost of a plan said in words a person reads at once
export function about(seconds: number): string {
  if (seconds < 90) return `about ${Math.max(1, Math.round(seconds))} s`;
  const min = Math.round(seconds / 60);
  if (min < 90) return `about ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `about ${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}`;
}
