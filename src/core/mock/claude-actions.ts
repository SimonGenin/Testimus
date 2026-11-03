import { ACTION_MARKER, TRIAGE_MARKER } from "../claude/actions.ts";
import { quietCtx } from "../command.ts";
import { commands } from "../commands/actions.ts";
import { fieldOrder } from "../lib/columns.ts";
import { readContext, writeContext } from "../lib/docs.ts";
import { readTest, testExists, writeTest } from "../lib/store.ts";
import { mockStream, registerMockScript } from "./claude.ts";

const DOC = "SOSIE_211_D401-1_3";
const TK_QUOTE = "un sectionneur avec TK manœuvré régulièrement ne propose que Propriétés";
const TK_RESULT = "Le menu contextuel ne propose que Propriétés.";

export const runIdIn = (prompt: string) => /runId: "([\w-]+)"/.exec(prompt)?.[1];

// ponytail: the scripted Claude calls actions_propose the way the real one does through MCP — the same command,
// so the action carries the run, model and effort of the prompt's runId
export function mockPropose(project: string, input: Record<string, unknown>): void {
  const c = commands.find((x) => x.name === "actions.propose");
  const parsed = c?.input.safeParse(input);
  if (c && parsed?.success) c.run(quietCtx(project), parsed.data as never).catch(() => {});
}

function triaged(prompt: string): { where: string; text: string }[] {
  return [...prompt.matchAll(/^- \[([^\]]+)\] (.+)$/gm)].map((m) => ({ where: m[1], text: m[2] }));
}

registerMockScript(
  (prompt) => prompt.startsWith(TRIAGE_MARKER),
  (spawn) => {
    const runId = runIdIn(spawn.stdin) ?? "";
    const fixable = triaged(spawn.stdin).filter((p) => /figure|caption|picture/i.test(p.text));
    return mockStream(spawn, {
      delayMs: 60,
      tools: [
        { name: "Read", input: { file_path: `docs/${DOC}/doc.json` } },
        { name: "Glob", input: { pattern: "**/*.pdf" } },
        ...fixable.map(() => ({ name: "mcp__testimus__actions_propose", input: { runId } })),
      ],
      edit: () => {
        for (const p of fixable) {
          const docId = p.where.replace(/^doc:/, "");
          const n = /Figure ([\w, -]+?)(?::| is)/.exec(p.text)?.[1]?.split(/,\s*/).length ?? 1;
          mockPropose(spawn.cwd, {
            runId,
            where: p.where,
            problem: p.text,
            title: n > 1 ? `Recover ${n} figures from the PDF` : "Recover the figure from the PDF",
            why: "A PDF rendering of the same document has the pictures the .docx lost.",
            plan: ["Find the PDF next to the .docx", "Convert again with it", "Check each caption has its figure"],
            scope: p.where.startsWith("doc:") ? { kind: "doc", docId } : { kind: "project" },
          });
        }
      },
      texts: [`${fixable.length} action(s) proposed.`],
      result: `${fixable.length} action(s) proposed.`,
    });
  },
);

function fixStep(project: string, id: string, n: number): string | null {
  if (!testExists(project, id)) return null;
  const { test } = readTest(project, id);
  const step = test.steps[n - 1];
  if (!step) return null;
  step.fields["Expected Result"] = TK_RESULT;
  step.sources = [{ docId: DOC, anchor: "§5.6.6", quote: TK_QUOTE }];
  writeTest(project, id, test, fieldOrder(project));
  return `Step ${n} of ${id} now says what the menu shows, with its source (§5.6.6).`;
}

function noteDoc(project: string, docId: string): string {
  const was = readContext(project, docId);
  writeContext(
    project,
    docId,
    `${was}${was && !was.endsWith("\n") ? "\n" : ""}Figures lost in the .docx: read them in the original.\n`,
  );
  return `No PDF of ${docId} was found next to the .docx. I noted in its context that the lost figures must be read in the original; add the PDF to recover them.`;
}

registerMockScript(
  (prompt) => prompt.startsWith(ACTION_MARKER),
  (spawn) => {
    const p = spawn.stdin;
    const step = /^Scope: step (\d+) of test ([\w.-]+)\./m.exec(p);
    const test = /^Scope: the whole test ([\w.-]+)\./m.exec(p);
    const doc = /^Scope: the document ([\w.-]+) /m.exec(p);
    let said = "I looked and found nothing to change.";
    return mockStream(spawn, {
      delayMs: 80,
      tools: [
        { name: "mcp__testimus__rag_search", input: { query: "menu contextuel sectionneur" } },
        { name: "mcp__testimus__rag_passage", input: { ref: `${DOC}#§5.6.6` } },
        doc
          ? { name: "mcp__testimus__docs_set", input: { id: doc[1] } }
          : { name: "mcp__testimus__tests_save", input: { id: step?.[2] ?? test?.[1] ?? "" } },
      ],
      edit: () => {
        said =
          (step && fixStep(spawn.cwd, step[2], Number(step[1]))) ||
          (test && fixStep(spawn.cwd, test[1], 1)) ||
          (doc && noteDoc(spawn.cwd, doc[1])) ||
          said;
      },
      texts: ["I read the passage the problem is about. "],
      get result() {
        return said;
      },
    });
  },
);
