import { describe, expect, it } from "vitest";
import { type Block, type HNode, parseHtml, renderBlocks } from "../../../../src/core/rag/convert-html.ts";

function md(html: string): string {
  const blocks: Block[] = renderBlocks(parseHtml(html).children, {
    image: (n: HNode) => `![${n.attrs.alt ?? ""}](${n.attrs.src})`,
    heading: (_n: HNode, level: number) => ({ kind: "heading", md: `${"#".repeat(level)} x`, text: "x" }),
  });
  return blocks.map((b) => b.md).join("\n\n");
}

describe("HTML to Markdown", () => {
  it("renders paragraphs with emphasis, links and entities", () => {
    expect(
      md(
        '<p>Le <strong>sectionneur </strong>est <em>ouvert</em> &amp; fermé&nbsp;: <a href="https://x.fr">lien</a></p>',
      ),
    ).toBe("Le **sectionneur** est *ouvert* & fermé : [lien](https://x.fr)");
    expect(md("<p><strong>a</strong><strong>b</strong></p>")).toBe("**ab**");
    expect(md('<p><a id="_Toc1"></a><a href="#_Toc2">interne</a></p>')).toBe("interne");
    expect(md("<p>court‑circuit­</p>")).toBe("court-circuit");
  });

  it("renders nested lists and skips empty wrapper items", () => {
    expect(md("<ul><li>un<ul><li>deux</li></ul></li><li>trois</li></ul>")).toBe("- un\n  - deux\n- trois");
    expect(md("<ol><li>a</li><li>b</li></ol>")).toBe("1. a\n2. b");
    expect(md("<ul><li><ul><li><ol><li>profond</li></ol></li></ul></li></ul>")).toBe("1. profond");
  });

  it("renders tables with spans as pipe tables", () => {
    const html =
      "<table><tr><th>A</th><th>B</th><th>C</th></tr>" +
      '<tr><td colspan="2"><p>x</p><p>y</p></td><td rowspan="2">z|w</td></tr>' +
      "<tr><td>1</td><td>2</td></tr></table>";
    expect(md(html)).toBe(
      ["| A | B | C |", "| --- | --- | --- |", "| x <br> y |  | z\\|w |", "| 1 | 2 |  |"].join("\n"),
    );
  });

  it("hands headings and images to the caller", () => {
    expect(md('<h3>t</h3><p><img src="a.png" alt="cap" /></p>')).toBe("### x\n\n![cap](a.png)");
  });
});
