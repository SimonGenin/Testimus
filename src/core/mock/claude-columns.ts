import { COLUMNS_MARKER, COLUMNS_TAG } from "../claude/columns.ts";
import { mockStream, registerMockScript } from "./claude.ts";

// ponytail: the fixture project names its screens and its operator positions — what a real run would find there;
// a request about something else gets an honest « nothing to change »
function proposals(ask: string): { name: string; description: string; why: string }[] {
  if (/rien|nothing|aucun/i.test(ask)) return [];
  return [
    {
      name: "Expected Result",
      description:
        "Everything the operator observes after the gesture — window, menu entries, colour, symbol, message — one observation per line, in the words of the document.",
      why: "The pulled tests list one observation per line (LFRPS12-1420), and § 5.6.6 names each menu entry.",
    },
    {
      name: "Data",
      description:
        "The object aimed at (sectionneur, track, signal) as the screen names it, and the values entered, only when the action needs them.",
      why: "§ 5.6.6 names each disconnector by its type; the pulled tests write it in Data.",
    },
    {
      name: "Poste",
      description: "The operator position the gesture is made from (TCO, PCC…), as the documents name it.",
      why: "§ 5.6 describes the same commands from two positions; no column says which one a step uses.",
    },
  ];
}

registerMockScript(
  (prompt) => prompt.startsWith(COLUMNS_MARKER),
  (spawn) => {
    const ask = spawn.stdin.match(/^The user asks: « (.*) »$/m)?.[1] ?? "";
    const list = proposals(ask);
    const block = `\`\`\`${COLUMNS_TAG}\n${JSON.stringify({ columns: list })}\n\`\`\``;
    const text = list.length
      ? `I read the columns, the 3 tests and § 5.6 of SOSIE_211_D401-1_3. I propose ${list.length} changes.\n\n${block}`
      : `The columns already say what the documents need.\n\n${block}`;
    return mockStream(spawn, {
      tools: [
        { name: "Skill", input: { skill: "define-columns" } },
        { name: "mcp__testimus__tests_list", input: {} },
        { name: "Read", input: { file_path: "tests/LFRPS12-1420/test.md" } },
        { name: "mcp__testimus__rag_search", input: { query: "poste opérateur TCO PCC" } },
        { name: "mcp__testimus__rag_passage", input: { docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6" } },
      ],
      texts: [text],
      result: text,
      delayMs: 120,
    });
  },
);
