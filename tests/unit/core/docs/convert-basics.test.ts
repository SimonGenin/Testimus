import { describe, expect, it } from "vitest";
import { anchorsOf, extOf, guessDate, guessTitle, slug, uniqueKey } from "../../../../src/core/rag/convert.ts";
import {
  cleanSpaces,
  decodeEntities,
  type HNode,
  inline,
  parseHtml,
  type RenderOpts,
  renderBlocks,
  textOf,
} from "../../../../src/core/rag/convert-html.ts";
import { encodePng, unpackGray1 } from "../../../../src/core/rag/convert-png.ts";

describe("convert helpers", () => {
  it("numbers a key that is already taken", () => {
    const used = new Set<string>();
    expect([uniqueKey(used, "a"), uniqueKey(used, "a"), uniqueKey(used, "a")]).toEqual(["a", "a-2", "a-3"]);
  });

  it("maps picture content types to file extensions", () => {
    expect(extOf("image/jpeg")).toBe("jpg");
    expect(extOf("image/pjpeg")).toBe("jpg");
    expect(extOf("image/x-emf")).toBe("emf");
    expect(extOf("emf")).toBe("emf");
    expect(extOf("image/x-wmf")).toBe("wmf");
    expect(extOf("wmf")).toBe("wmf");
    expect(extOf("image/svg+xml")).toBe("svg");
    expect(extOf("image/tiff")).toBe("tif");
    expect(extOf("image/x-tiff")).toBe("tif");
    expect(extOf("IMAGE/PNG")).toBe("png");
    expect(extOf("application/octet stream")).toBe("bin");
  });

  it("falls back for slugs, dates and titles", () => {
    expect(slug("!!!")).toBe("section");
    expect(slug("Élément été")).toBe("element-ete");
    expect(guessDate("issued 2026-03-04 here")).toBe("2026-03-04");
    expect(guessDate("no date")).toBe("");
    expect(guessTitle(["ab", "**"])).toBe("");
    expect(guessTitle(["Projet X", "Cahier des charges"])).toBe("Cahier des charges");
  });

  it("lists anchors and ignores page markers and other comments", () => {
    expect(anchorsOf("<!-- page 1 --> <!-- § 2 --> <!-- req R1 --> <!-- fig 3 -->")).toEqual({
      sections: ["2"],
      figures: ["3"],
    });
  });
});

describe("PNG helpers", () => {
  it("unpacks one-bit rows padded to a byte", () => {
    expect([...unpackGray1(3, 2, new Uint8Array([0b10100000, 0b01000000]))]).toEqual([255, 0, 255, 0, 255, 0]);
  });

  it("encodes gray and RGBA colour types", () => {
    expect(encodePng(1, 1, 1, new Uint8Array([9]))[25]).toBe(0);
    expect(encodePng(1, 1, 4, new Uint8Array([1, 2, 3, 4]))[25]).toBe(6);
  });
});

describe("HTML reader", () => {
  const opts: RenderOpts = {
    image: (n) => `![${n.attrs.alt ?? ""}](${n.attrs.src ?? ""})`,
    heading: (n, level) => (level === 6 ? null : { kind: "heading", md: `H${level} ${textOf(n)}`, text: textOf(n) }),
  };

  it("decodes every named and numeric entity", () => {
    expect(decodeEntities("&amp;&lt;&gt;&quot;&apos;&nbsp;&#65;&#x42;&unknown;")).toBe("&<>\"' AB&unknown;");
  });

  it("reads a numeric entity past the last code point as the replacement character, never throws", () => {
    expect(decodeEntities("a &#x110000; b &#99999999999;")).toBe("a \uFFFD b \uFFFD");
  });

  it("reads attributes quoted, single-quoted, bare and empty", () => {
    const root = parseHtml(`<img src='a.png' alt=bare data-x title="t &amp; u"/><p>x</P></div>`);
    expect(root.children[0].attrs).toEqual({ src: "a.png", alt: "bare", "data-x": "", title: "t & u" });
    expect(root.children[1].tag).toBe("p");
  });

  it("reads text of text nodes without text and of line breaks", () => {
    const node: HNode = {
      tag: "p",
      attrs: {},
      children: [
        { tag: "#text", attrs: {}, children: [] },
        { tag: "br", attrs: {}, children: [] },
      ],
    };
    expect(textOf(node)).toBe("\n");
    expect(inline(node.children, opts)).toBe("\n");
  });

  it("drops empty marks and keeps plain labels of links", () => {
    expect(inline(parseHtml("<b> </b><i>x</i>").children, opts)).toBe(" *x*");
    expect(inline(parseHtml("<a>no href</a> <a href='ftp://x'>ftp</a> <a href='http://x'> </a>").children, opts)).toBe(
      "no href ftp  ",
    );
    expect(inline(parseHtml("<b>bold</b><a href='https://x'>link</a>").children, opts, true)).toBe("boldlink");
    expect(cleanSpaces("a­‑b\t\tc")).toBe("a-b c");
  });

  it("renders lists with decorations, skipping non-items", () => {
    const blocks = renderBlocks(
      parseHtml("<ol><span>x</span><li>one</li><li><ul><li>deep</li></ul></li></ol>").children,
      {
        ...opts,
        decorate: (_n, md) => `${md}!`,
      },
    );
    expect(blocks).toEqual([{ kind: "list", md: "1. one!\n- deep!", text: "one\ndeep" }]);
  });

  it("renders tables with header and footer groups, and empty tables", () => {
    const html =
      "<table><thead><tr><th>A</th><span>x</span><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody><tfoot><tr><td>3</td></tr></tfoot></table><table></table>";
    const blocks = renderBlocks(parseHtml(html).children, opts);
    expect(blocks[0].md).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 |  |");
    expect(blocks[1].md).toBe("|  |\n| --- |");
  });

  it("keeps a loose picture as an image block and drops headings the caller refuses", () => {
    const blocks = renderBlocks(parseHtml("<img src='p.png' alt='cap'><h6>gone</h6><h2>kept</h2>").children, opts);
    expect(blocks.map((b) => b.kind)).toEqual(["image", "heading"]);
  });

  it("lets the caller replace or drop a paragraph", () => {
    const blocks = renderBlocks(parseHtml("<p>a</p><div>b</div><blockquote>c</blockquote>").children, {
      ...opts,
      paragraph: (n) =>
        textOf(n) === "a" ? null : textOf(n) === "b" ? { kind: "para", md: "B", text: "B" } : undefined,
    });
    expect(blocks.map((b) => b.md)).toEqual(["B", "c"]);
  });
});
