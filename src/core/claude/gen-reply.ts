import { parseSource } from "../lib/testfile.ts";
import { isSection, PLAN_TAG, REPORT_TAG } from "./gen-prompt.ts";

// ponytail: what a generation run answers — the report block of the generate-tests skill, or the plan of plan-tests

export type Skipped = { item: string; category: string; why: string; sources?: string[] };

// ponytail: a report written before skipped items had a category (or a model that left it out) still reads — its
// items fall under one word the page groups like any other
export const OTHER = "Other";
export type GenReport = {
  found: boolean;
  tests: string[];
  skipped: Skipped[];
  consulted: string[];
};

export type PlannedTest = { summary: string; technique: string; sections: string[] };
export type TestPlan = { found: boolean; tests: PlannedTest[]; skipped: Skipped[] };

function asStrings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : [];
}

function asSkipped(v: unknown): Skipped[] {
  if (!Array.isArray(v)) return [];
  const out: Skipped[] = [];
  for (const u of v) {
    if (typeof u === "string" && u.trim()) out.push({ item: u.trim(), category: OTHER, why: "" });
    else if (u && typeof u === "object") {
      const o = u as Record<string, unknown>;
      const text = (k: string) => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
      const item = text("item");
      const sources = asStrings(o.sources).filter((s) => parseSource(s));
      if (item)
        out.push({
          item,
          category: text("category").replace(/\s+/g, " ") || OTHER,
          why: text("why"),
          ...(sources.length > 0 && { sources }),
        });
    }
  }
  return out;
}

// ponytail: the report is the last fenced block tagged gen-report; a plain ```json block that holds
// "skipped" is accepted too, because a model sometimes drops the tag — anything else is no report
export function parseGenReport(text: string): GenReport {
  const blocks = [...text.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
  const tagged = blocks.filter((b) => b[1] === REPORT_TAG);
  const loose = blocks.filter((b) => b[1] !== REPORT_TAG && b[2].includes('"skipped"'));
  for (const b of [...tagged.reverse(), ...loose.reverse()]) {
    try {
      const o = JSON.parse(b[2]) as Record<string, unknown>;
      if (!o || typeof o !== "object" || Array.isArray(o)) continue;
      return {
        found: true,
        tests: asStrings(o.tests),
        skipped: asSkipped(o.skipped),
        consulted: asStrings(o.consulted),
      };
    } catch {}
  }
  return { found: false, tests: [], skipped: [], consulted: [] };
}

// ponytail: the plan is the last fenced block tagged test-plan; a planned test needs a summary, and keeps only the
// sections written docId#anchor
export function parsePlan(text: string): TestPlan {
  const blocks = [...text.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)```/g)].filter((b) => b[1] === PLAN_TAG);
  for (const b of blocks.reverse()) {
    try {
      const o = JSON.parse(b[2]) as Record<string, unknown>;
      if (!o || typeof o !== "object" || !Array.isArray(o.tests)) continue;
      const tests: PlannedTest[] = [];
      for (const t of o.tests as unknown[]) {
        if (!t || typeof t !== "object") continue;
        const x = t as Record<string, unknown>;
        const summary = typeof x.summary === "string" ? x.summary.trim() : "";
        if (!summary) continue;
        tests.push({
          summary,
          technique: typeof x.technique === "string" ? x.technique.trim() : "",
          sections: asStrings(x.sections).filter(isSection),
        });
      }
      if (tests.length) return { found: true, tests, skipped: asSkipped(o.skipped) };
    } catch {}
  }
  return { found: false, tests: [], skipped: [] };
}
