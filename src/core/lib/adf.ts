export type AdfNode = {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: unknown[];
};
export type AdfDoc = { type: "doc"; version: number; content: AdfNode[] };

const ISSUE_URL = /\/browse\/([A-Z][A-Z0-9_]*-\d+)/;

function inline(n: AdfNode): string {
  switch (n.type) {
    case "text":
      return n.text ?? "";
    case "hardBreak":
      return "\n";
    case "mention":
      return String(n.attrs?.text ?? "");
    case "emoji":
      return String(n.attrs?.text ?? n.attrs?.shortName ?? "");
    // ponytail: Jira renders issue links as cards with no text node; the key lives in the url.
    case "inlineCard":
    case "blockCard": {
      const url = String(n.attrs?.url ?? "");
      return ISSUE_URL.exec(url)?.[1] ?? url;
    }
    default:
      return (n.content ?? []).map(inline).join("");
  }
}

function lines(n: AdfNode, prefix = ""): string[] {
  if (n.type === "bulletList") return (n.content ?? []).flatMap((li) => lines(li, "- "));
  if (n.type === "orderedList") return (n.content ?? []).flatMap((li, i) => lines(li, `${i + 1}. `));
  if (n.type === "listItem")
    return (n.content ?? []).flatMap((c, i) => (i === 0 ? lines(c, prefix) : lines(c).map((l) => `  ${l}`)));
  if (n.type === "tableRow") return [prefix + (n.content ?? []).map((c) => lines(c).join(" ")).join(" | ")];
  // ponytail: a panel, a quote, a table, an expand hold blocks — each is a line of its own, never glued to the next
  if (n.content?.some((c) => Array.isArray(c.content) || c.type === "paragraph"))
    return n.content.flatMap((c, i) => lines(c, i === 0 ? prefix : ""));
  return inline(n)
    .split("\n")
    .map((l, i) => (i === 0 ? prefix + l : l));
}

export function adfToText(doc: AdfDoc | AdfNode | null | undefined): string {
  if (!doc) return "";
  if (typeof doc === "string") return doc;
  if (doc.type === "doc") return (doc.content ?? []).flatMap((n) => lines(n)).join("\n");
  return lines(doc).join("\n");
}

export function textToAdf(text: string): AdfDoc {
  return {
    type: "doc",
    version: 1,
    content: text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) =>
        line ? { type: "paragraph", content: [{ type: "text", text: line }] } : { type: "paragraph", content: [] },
      ),
  };
}
