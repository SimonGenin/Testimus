import { CONVERSION_CHECK_MARKER, CONVERSION_TAG, STUDY_MARKER } from "../claude/study.ts";
import { mockStream, registerMockScript } from "./claude.ts";

const idIn = (prompt: string) => / the document (\S+) /.exec(prompt)?.[1] ?? "";

// ponytail: the scripted study looks at two pages and keeps what Testimus chose, with a note for the check
registerMockScript(
  (prompt) => prompt.startsWith(STUDY_MARKER),
  (spawn) => {
    const id = idIn(spawn.stdin);
    const reply = [
      "```" + CONVERSION_TAG,
      JSON.stringify({ notes: "Simulated study: captions « Figure N – … », headings numbered in the text." }),
      "```",
    ].join("\n");
    return mockStream(spawn, {
      delayMs: 40,
      tools: [
        { name: "mcp__testimus__docs_page", input: { id, page: 1 } },
        { name: "mcp__testimus__docs_page", input: { id, page: 2 } },
      ],
      texts: [reply],
      result: reply,
    });
  },
);

registerMockScript(
  (prompt) => prompt.startsWith(CONVERSION_CHECK_MARKER),
  (spawn) => {
    const id = idIn(spawn.stdin);
    const line = "Compared the outline, two tables and three figures with the pages: no difference.";
    return mockStream(spawn, {
      delayMs: 40,
      tools: [
        { name: "mcp__testimus__docs_show", input: { id, brief: true } },
        { name: "mcp__testimus__docs_page", input: { id, page: 3 } },
      ],
      texts: [line],
      result: line,
    });
  },
);
