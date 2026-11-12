import { REPLAN_MARKER } from "../claude/gen-plan.ts";
import { REVIEW_MARKER } from "../claude/gen-prompt.ts";
import { PLAN_TAG } from "../claude/gen-reply.ts";
import { mockStream, registerMockScript } from "./claude.ts";
import { DOC, SKIPPED, TK } from "./claude-gen.ts";

// ponytail: registered after claude-gen.ts (it imports it), so a request planned first beats the writing script

// ponytail: a plan to review — three tests in two themes and one question; revised with the user's answers, the
// question is gone, the answer shows in the third test, and a test the user unticked is dropped
const REVIEW_QUESTION = {
  id: "q1",
  text: "Le menu d'un sectionneur avec TK en défaut propose-t-il les commandes manuelles ?",
  why: "Le §5.6.6 décrit le menu d'un sectionneur avec TK manœuvré régulièrement, sans dire ce qu'il devient quand la TK est en défaut.",
  sources: [TK],
  answers: ["Oui, comme un sectionneur sans TK", "Non, seulement Propriétés"],
};

function reviewPlan(prompt: string) {
  const answer = prompt.match(/^- Le menu d'un sectionneur avec TK en défaut[^\n]*→ (.+)$/m)?.[1]?.trim();
  const unticked = [...prompt.matchAll(/^- \d+\. (.+?)(?: \(.*\))? — unticked: not written$/gm)].map((m) => m[1]);
  const tests = [
    {
      summary: "Menu contextuel et ouverture",
      theme: "Sectionneurs sans TK",
      technique: "cas d'utilisation",
      sections: [`${DOC}#§5.6.6`],
    },
    {
      summary: "Fenêtre Propriétés",
      theme: "Sectionneurs sans TK",
      technique: "cas d'utilisation",
      sections: [`${DOC}#§5.6.7`],
    },
    {
      summary: answer ? `Menu réduit, TK en défaut : ${answer}` : "Menu réduit à Propriétés",
      theme: "Sectionneurs avec TK",
      technique: "chemin négatif",
      sections: [`${DOC}#§5.6.6`],
    },
  ].filter((t) => !unticked.includes(t.summary));
  return { tests, skipped: SKIPPED.slice(2), questions: answer ? [] : [REVIEW_QUESTION] };
}

registerMockScript(
  (prompt) => prompt.includes(REVIEW_MARKER) || prompt.includes(REPLAN_MARKER),
  (spawn) => {
    const plan = reviewPlan(spawn.stdin);
    const reply = `Plan : ${plan.tests.length} tests.\n\n\`\`\`${PLAN_TAG}\n${JSON.stringify(plan)}\n\`\`\``;
    return mockStream(spawn, {
      tools: [
        { name: "Skill", input: { skill: "plan-tests" } },
        { name: "mcp__testimus__docs_show", input: { id: DOC } },
        { name: "mcp__testimus__rag_passage", input: { ref: `${DOC}#§5.6.6` } },
      ],
      texts: [reply],
      result: reply,
      costUsd: 0.0904,
    });
  },
);
