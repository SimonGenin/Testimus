import { NEXT_MARKER, NEXT_TAG } from "../claude/gen-next.ts";
import { mockStream, registerMockScript } from "./claude.ts";

// ponytail: the scripted Claude after a generation reads the tests and findings its prompt lists and answers the way
// the real one does — a concrete fix per finding (at most 3 per test) and suggestions that name what these tests hold

type Listed = { id: string; summary: string; findings: { step?: number; kind: string }[] };

function listed(prompt: string): Listed[] {
  const out: Listed[] = [];
  for (const line of prompt.split("\n")) {
    const head = /^## (local-[0-9a-f]{8}) — « (.+) » \(\d+ steps?\)$/.exec(line);
    if (head) out.push({ id: head[1], summary: head[2], findings: [] });
    const f = /^- (?:error|warning)(?:, step (\d+))?, ([\w-]+): /.exec(line);
    if (f && out.length) out[out.length - 1].findings.push({ step: f[1] ? Number(f[1]) : undefined, kind: f[2] });
  }
  return out;
}

function fixOf(f: Listed["findings"][number]) {
  const at = f.step ? `step ${f.step}` : "the test";
  if (f.kind === "negative-missing")
    return {
      title: "Add the TK case: the menu shows only Propriétés",
      problem: "No step checks that a sectionneur with TK operated regularly offers only Propriétés.",
      why: "§5.6.6 states it in one sentence the test can quote.",
      plan: ["Read §5.6.6", "Add a step: right-click a sectionneur with TK", "Quote the passage as its source"],
      model: "sonnet",
      effort: "medium",
    };
  if (f.kind === "vague-result")
    return {
      title: `List the commands §5.6.6 gives in ${at}`,
      problem: `The expected result of ${at} does not say what the tester sees.`,
      why: "§5.6.6 lists the commands offered for each type of sectionneur.",
      plan: [`Read §5.6.6`, `Rewrite the expected result of ${at} with the commands it lists`, "Keep its source"],
      model: "haiku",
      effort: "low",
    };
  return {
    title: `Source or drop « not simulated » in ${at}`.slice(0, 60),
    problem: `${at[0].toUpperCase()}${at.slice(1)} says the traction is not simulated; no passage says so.`,
    why: "Either a passage says it, or the claim goes.",
    plan: ["Search for « simulé » in the documents", "Quote the passage, or remove the claim"],
    model: "sonnet",
    effort: "medium",
  };
}

export function mockNext(prompt: string): string {
  const tests = listed(prompt);
  const fixes = tests.flatMap((t) => t.findings.slice(0, 3).map((f) => ({ test: t.id, ...fixOf(f) })));
  const menu = tests.filter((t) => /menu/i.test(t.summary));
  const suggestions = [
    {
      label: "Add the faulty TK cases",
      prompt: "Add tests where the sectionneur's TK is faulty: what the menu and the Propriétés window show then.",
      scope: "add",
    },
    {
      label: "Check each command of the menu",
      prompt: "In each test that opens the context menu, check every command it lists against §5.6.6.",
      scope: "change",
    },
    ...(menu.length > 1
      ? [
          {
            label: `Merge the ${menu.length} menu tests`,
            prompt: "Merge the tests that open the same context menu into one test, keeping every check and source.",
            scope: "change",
          },
        ]
      : []),
    ...(prompt.includes("Items no test was written for:")
      ? [
          {
            label: "Write the items not written",
            prompt: "Write tests for the items not written where a figure or another section now supports them.",
            scope: "add",
          },
        ]
      : []),
  ];
  return `I read the ${tests.length} test(s) and their findings.\n\n\`\`\`${NEXT_TAG}\n${JSON.stringify({ fixes, suggestions }, null, 2)}\n\`\`\``;
}

registerMockScript(
  (prompt) => prompt.startsWith(NEXT_MARKER),
  (spawn) => {
    const reply = mockNext(spawn.stdin);
    return mockStream(spawn, { delayMs: 60, texts: [reply], result: reply, costUsd: 0.0081 });
  },
);
