import type { Step } from "../../../../core/types.ts";
import { leafBlocks } from "../../../lib/blocks.ts";
import { tablesIn } from "../../../lib/table.ts";

// ponytail: one blank line between blocks — a field is Xray text, and a marker glued to a sentence
// renders inside the paragraph; inside a table cell it is a single line break, or the table would end
const inTable = (text: string, at: number) => tablesIn(text).some((t) => at > t.at && at < t.end);
export const gap = (text: string, at: number) => (inTable(text, at) ? "\n" : "\n\n");

export const put = (text: string, at: number, chunk: string) =>
  [text.slice(0, at).replace(/\s+$/, ""), chunk, text.slice(at).replace(/^\s+/, "")]
    .filter(Boolean)
    .join(gap(text, at));

export const cut = (text: string, at: number, end: number) =>
  [text.slice(0, at).replace(/\s+$/, ""), text.slice(end).replace(/^\s+/, "")].filter(Boolean).join(gap(text, at));

export const firstLine = (s: string) =>
  s
    .replace(/!\[\]\([^)]*\)/g, "")
    .trim()
    .split("\n")[0] ?? "";

export const setField = (s: Step, name: string, value: string): Step => {
  const fields = { ...s.fields };
  if (value) fields[name] = value;
  else delete fields[name];
  return { ...s, fields };
};

export const embeds = (s: Step, file: string) =>
  Object.values(s.fields).some((t) => leafBlocks(t, s.images).some((x) => x.kind === "image" && x.image.file === file));

export const fileName = (file: string) => file.split("/").pop() ?? file;
