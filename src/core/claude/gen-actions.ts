import type { Ctx } from "../command.ts";
import { env } from "../env.ts";
import { type Proposal, proposeAction } from "../lib/actions.ts";
import { quoted, testName } from "../lib/names.ts";
import { readCheck, testExists } from "../lib/store.ts";
import type { Effort, Finding } from "../types.ts";
import { type Skipped, STOPPED } from "./gen-reply.ts";

// ponytail: after a generation the core itself leaves a Claude action per problem it can name — a test of the
// generation with findings, a category of tests not written — the same actions.* as any run's proposals: one per
// problem, stale when its test changes or the generation's list of tests not written moves (where gen:<id>), dismissed
// for good. A planned test stopped by a cancel is resumed, not acted on; an action that cannot be proposed is a warning,
// never the generation's failure

const MAX_TITLE = 80;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function findingsLine(findings: Finding[]): string {
  return findings
    .filter((f) => f.severity !== "info")
    .map((f) => `${f.kind}${f.step ? ` (step ${f.step})` : ""}: ${f.message}`)
    .join(" · ");
}

export type ProposedBy = { runId: string; model: string; effort: Effort | "" };

export function proposeGenActions(
  project: string,
  generation: string,
  o: { tests: string[]; skipped: Skipped[]; by: ProposedBy },
  log: Ctx["log"],
): void {
  const propose = (p: Proposal) => {
    try {
      proposeAction(project, p);
    } catch (e) {
      log("warn", `No Claude action for « ${p.title} »: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const proposedBy = {
    run: "generate",
    model: o.by.model,
    effort: o.by.effort,
    at: env.now().toISOString(),
    runId: o.by.runId,
  };
  for (const id of o.tests) {
    if (!testExists(project, id)) continue;
    const findings = readCheck(project, id)?.findings ?? [];
    const errors = findings.filter((f) => f.severity === "error").length;
    const warnings = findings.filter((f) => f.severity === "warning").length;
    if (!errors && !warnings) continue;
    const name = testName(project, id);
    const what = errors ? plural(errors, "error") : plural(warnings, "warning");
    const head = `Fix the ${what} in `;
    propose({
      title: `${head}${quoted(clip(name, MAX_TITLE - head.length - 4))}`,
      scope: { kind: "test", testId: id },
      where: `test:${id}`,
      problem: `The check found ${[errors && plural(errors, "error"), warnings && plural(warnings, "warning")].filter(Boolean).join(" and ")}: ${findingsLine(findings)}`,
      why: "Each finding names its step and the passage that settles it: the fix is in the documents.",
      plan: [
        "Read the findings (check_show) and the passages they cite",
        "Correct each step from its source, keeping what was right",
        "Run check_run on the test until nothing fixable is left",
      ],
      proposedBy,
      suggest: { model: "sonnet", effort: errors ? "high" : "medium" },
    });
  }
  const groups = new Map<string, Skipped[]>();
  for (const s of o.skipped) if (s.category !== STOPPED) groups.set(s.category, [...(groups.get(s.category) ?? []), s]);
  for (const [category, items] of groups) {
    const head = `Write the ${plural(items.length, "test")} skipped for `;
    propose({
      title: `${head}${quoted(clip(category, MAX_TITLE - head.length - 4))}`,
      scope: { kind: "project" },
      where: `gen:${generation}`,
      problem: `${plural(items.length, "test")} not written — ${category}: ${items.map((s) => `${s.item}${s.why ? ` (${s.why})` : ""}`).join("; ")}`,
      why: "Each item says what was missing; a source may exist under other words, in a figure or in a context.",
      plan: [
        "Search again for each item (rag_mentions, rag_related, the documents' context.md)",
        "Write a test (tests_create) for each item a source now supports, in the generation's folder",
        "Leave the others and say why",
      ],
      proposedBy,
      suggest: { model: "opus", effort: "high" },
    });
  }
}
