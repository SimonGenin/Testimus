import { describe, expect, it } from "vitest";
import { type AdfDoc, adfToText } from "../../../../src/core/lib/adf.ts";

const doc = (...content: unknown[]): AdfDoc => ({ type: "doc", version: 1, content: content as AdfDoc["content"] });
const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const cell = (text: string, type = "tableCell") => ({ type, content: [p(text)] });

describe("adfToText on blocks that hold blocks", () => {
  it("keeps the paragraphs of a panel, a quote and an expand on their own lines", () => {
    expect(adfToText(doc({ type: "panel", attrs: { panelType: "info" }, content: [p("one"), p("two")] }))).toBe(
      "one\ntwo",
    );
    expect(adfToText(doc({ type: "blockquote", content: [p("one"), { type: "paragraph" }, p("two")] }))).toBe(
      "one\n\ntwo",
    );
    expect(adfToText(doc(p("before"), { type: "expand", content: [p("a"), p("b")] }))).toBe("before\na\nb");
  });

  it("writes a table one row per line, its cells apart", () => {
    const table = {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("Code", "tableHeader"), cell("Libellé", "tableHeader")] },
        { type: "tableRow", content: [cell("A1"), cell("Arrêt")] },
      ],
    };
    expect(adfToText(doc(table))).toBe("Code | Libellé\nA1 | Arrêt");
  });

  it("indents a list nested in a list item", () => {
    const item = (...content: unknown[]) => ({ type: "listItem", content });
    const d = doc({
      type: "bulletList",
      content: [item(p("a"), { type: "bulletList", content: [item(p("b"))] }), item(p("c"))],
    });
    expect(adfToText(d)).toBe("- a\n  - b\n- c");
  });
});
