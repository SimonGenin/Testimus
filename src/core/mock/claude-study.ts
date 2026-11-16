import { CONVERSION_CHECK_MARKER, CONVERSION_TAG, STUDY_MARKER } from "../claude/study.ts";
import { TABLE_MARKER, TABLE_TAG } from "../claude/table.ts";
import type { TableProfile } from "../rag/convert-table.ts";
import type { WorkbookProfile } from "../rag/convert-xlsx.ts";
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

// ponytail: the scripted table reading keeps Testimus' key, titles the rows by the next short column and gives each
// column a meaning made from its name and its first value; a workbook, the same for each sheet
function simulated(profile: Partial<TableProfile>) {
  const columns = profile.columns ?? [];
  const key = profile.guess?.key;
  const title = columns.find((c) => c.name !== key && c.filled && c.longest <= 60)?.name;
  return {
    ...(key ? { key } : {}),
    ...(title ? { title } : {}),
    about: `Simulated reading: a table of ${profile.rows ?? 0} rows.`,
    columns: columns.map((c) => ({
      name: c.name,
      ...(c.filled ? { meaning: `Simulated: ${c.name}, e.g. « ${c.samples[0]} »` } : { skip: true }),
    })),
  };
}

registerMockScript(
  (prompt) => prompt.startsWith(TABLE_MARKER),
  (spawn) => {
    const json = /```json\n([\s\S]*?)\n```/.exec(spawn.stdin)?.[1] ?? "{}";
    const profile = JSON.parse(json) as Partial<TableProfile> & Partial<WorkbookProfile>;
    const read = profile.sheets
      ? { sheets: profile.sheets.map((s) => ({ name: s.name, ...simulated(s) })) }
      : simulated(profile);
    const reply = ["```" + TABLE_TAG, JSON.stringify(read), "```"].join("\n");
    return mockStream(spawn, { delayMs: 40, tools: [], texts: [reply], result: reply });
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
