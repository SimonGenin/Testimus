export type AdfNode = {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: unknown[];
};
export type AdfDoc = { type: "doc"; version: number; content: AdfNode[] };

const ISSUE_URL = /\/browse\/([A-Z][A-Z0-9_]*-\d+)/;

/** a mention in a comment's text: @[Camille Martin](<account id>) — the one way the app writes one, read and sent */
export const MENTION = /@\[([^\]\n]+)\]\(([^)\s]+)\)/g;

// ponytail: a description reads a mention as its plain « @Name »; a comment keeps who it is (mentions: true)
export type AdfText = { mentions?: boolean };

function inline(n: AdfNode, o: AdfText): string {
  switch (n.type) {
    case "text":
      return n.text ?? "";
    case "hardBreak":
      return "\n";
    case "mention": {
      const text = String(n.attrs?.text ?? "");
      return o.mentions && n.attrs?.id ? `@[${text.replace(/^@/, "")}](${String(n.attrs.id)})` : text;
    }
    case "emoji":
      return String(n.attrs?.text ?? n.attrs?.shortName ?? "");
    // ponytail: Jira renders issue links as cards with no text node; the key lives in the url.
    case "inlineCard":
    case "blockCard": {
      const url = String(n.attrs?.url ?? "");
      return ISSUE_URL.exec(url)?.[1] ?? url;
    }
    default:
      return (n.content ?? []).map((c) => inline(c, o)).join("");
  }
}

function lines(n: AdfNode, o: AdfText, prefix = ""): string[] {
  if (n.type === "bulletList") return (n.content ?? []).flatMap((li) => lines(li, o, "- "));
  if (n.type === "orderedList") return (n.content ?? []).flatMap((li, i) => lines(li, o, `${i + 1}. `));
  if (n.type === "listItem")
    return (n.content ?? []).flatMap((c, i) => (i === 0 ? lines(c, o, prefix) : lines(c, o).map((l) => `  ${l}`)));
  if (n.type === "tableRow") return [prefix + (n.content ?? []).map((c) => lines(c, o).join(" ")).join(" | ")];
  // ponytail: a panel, a quote, a table, an expand hold blocks — each is a line of its own, never glued to the next
  if (n.content?.some((c) => Array.isArray(c.content) || c.type === "paragraph"))
    return n.content.flatMap((c, i) => lines(c, o, i === 0 ? prefix : ""));
  return inline(n, o)
    .split("\n")
    .map((l, i) => (i === 0 ? prefix + l : l));
}

export function adfToText(doc: AdfDoc | AdfNode | null | undefined, o: AdfText = {}): string {
  if (!doc) return "";
  if (typeof doc === "string") return doc;
  if (doc.type === "doc") return (doc.content ?? []).flatMap((n) => lines(n, o)).join("\n");
  return lines(doc, o).join("\n");
}

function lineNodes(line: string, o: AdfText): AdfNode[] {
  if (!o.mentions) return [{ type: "text", text: line }];
  const out: AdfNode[] = [];
  let at = 0;
  for (const m of line.matchAll(MENTION)) {
    if (m.index > at) out.push({ type: "text", text: line.slice(at, m.index) });
    out.push({ type: "mention", attrs: { id: m[2], text: `@${m[1]}` } });
    at = m.index + m[0].length;
  }
  if (at < line.length) out.push({ type: "text", text: line.slice(at) });
  return out;
}

export function textToAdf(text: string, o: AdfText = {}): AdfDoc {
  return {
    type: "doc",
    version: 1,
    content: text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => (line ? { type: "paragraph", content: lineNodes(line, o) } : { type: "paragraph", content: [] })),
  };
}
