import { CHECK_MARKER } from "../../../src/core/claude/check.ts";
import { REVIEW_TAG } from "../../../src/core/claude/gen-review.ts";
import { invoke } from "../../../src/core/commands/index.ts";
import type { ClaudeOut, ClaudeSpawn } from "../../../src/core/env.ts";
import { readTest, testExists } from "../../../src/core/lib/store.ts";
import type { Finding, StepVerdict } from "../../../src/core/types.ts";

// ponytail: a test's fake Claude answers a check request the way the check-test skill does (claude/check.ts): one
// request names several tests, each is recorded on its own through check.record — called as an LLM, so the fake is
// held to the same proof as Claude — and the reply has one line per test, then the gen-review block when the request
// asks for one. A fake that only prints a check_record call records nothing: the check then counts as not recorded

export type Found = Omit<Finding, "pass">;

export const isCheck = (s: ClaudeSpawn): boolean => s.stdin.startsWith(CHECK_MARKER);

/** the tests a check request names, one per line: « - <id> — « summary », n steps. » */
export const checkedIn = (prompt: string): string[] =>
  [...prompt.matchAll(/^- ([A-Za-z0-9][\w.-]*) — « /gm)].map((m) => m[1]);

/** whether the request also asks what is to be said of a generation (claude/gen-review.ts) */
export const asksReview = (prompt: string): boolean => prompt.includes(`\`\`\`${REVIEW_TAG}`);

const refsOf = (project: string, id: string, step: number): string[] => [
  ...new Set(
    readTest(project, id)
      .test.steps[step - 1].sources.filter((x) => x.anchor)
      .map((x) => `${x.docId}#${x.anchor}`),
  ),
];

/** a verdict per step: supported by the passages the step cites, unverified when it cites none */
export const verdictsOf = (project: string, id: string): StepVerdict[] =>
  readTest(project, id).test.steps.map((_, i) => {
    const read = refsOf(project, id, i + 1);
    return read.length
      ? { step: i + 1, verdict: "supported" as const, read }
      : { step: i + 1, verdict: "unverified" as const, read: [], why: "The step cites no passage." };
  });

export const line = (m: unknown): string => JSON.stringify(m);

export const toolLine = (name: string, input: unknown, id = `t-${Math.random().toString(16).slice(2)}`): string =>
  line({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });

export const resultLine = (text: string, isError = false): string =>
  line({ type: "result", subtype: "success", is_error: isError, result: text, session_id: "s-1", duration_ms: 5 });

/** the stream line of a check_record call: what the core looks for in the run's own tool calls */
export const recordCall = (id: string): string => toolLine("mcp__testimus__check_record", { id });

/** records the check of one test as a Claude run does (ctx.llm): refused unless every step has its verdict */
export const recordCheck = (
  project: string,
  id: string,
  findings: Found[] = [],
  steps: StepVerdict[] = verdictsOf(project, id),
): Promise<unknown> => invoke("check.record", { id, steps, findings }, { project, llm: true });

export type CheckAnswer = {
  /** the findings recorded for a test (default: none) */
  findings?(id: string): Found[];
  /** the verdicts recorded for a test (default: verdictsOf) */
  steps?(id: string): StepVerdict[];
  /** the passages the run opens with rag_passage (default: every passage its verdicts name) */
  opens?: string[];
  /** the tests of the request it records (default: all of them) */
  only?(id: string): boolean;
  /** the gen-review block of the reply, as JSON (default: no second look, no suggestion) */
  review?: unknown;
};

// ponytail: the whole answer to a check request — every test named is recorded, the stream shows the passages opened
// and one check_record per test, the reply counts each test's findings and ends with the review block when asked
export async function answerCheck(s: ClaudeSpawn, o: CheckAnswer = {}): Promise<string[]> {
  const ids = checkedIn(s.stdin).filter((id) => testExists(s.cwd, id) && (o.only?.(id) ?? true));
  const lines: string[] = [];
  const said: string[] = [];
  const opened = new Set<string>();
  for (const id of ids) {
    const steps = o.steps?.(id) ?? verdictsOf(s.cwd, id);
    const findings = o.findings?.(id) ?? [];
    await recordCheck(s.cwd, id, findings, steps);
    for (const ref of o.opens ?? steps.flatMap((v) => v.read)) {
      if (opened.has(ref)) continue;
      opened.add(ref);
      lines.push(toolLine("mcp__testimus__rag_passage", { ref }));
    }
    lines.push(recordCall(id));
    const n = (sev: string) => findings.filter((f) => f.severity === sev).length;
    said.push(`${id}: ${n("error")} error(s), ${n("warning")} warning(s), ${n("info")} info(s).`);
  }
  const review = asksReview(s.stdin)
    ? `\n\n\`\`\`${REVIEW_TAG}\n${JSON.stringify(o.review ?? { suggestions: [] })}\n\`\`\``
    : "";
  lines.push(resultLine(`${said.join("\n")}${review}`));
  return lines;
}

export async function checkOut(s: ClaudeSpawn, o: CheckAnswer = {}): Promise<ClaudeOut> {
  const lines = await answerCheck(s, o);
  for (const l of lines) s.onLine?.(l);
  return { code: 0, stdout: `${lines.join("\n")}\n`, stderr: "" };
}
