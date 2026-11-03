import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  approxTokens,
  chunkDoc,
  docFigures,
  MAX_TOKENS,
  markerLine,
  sectionAt,
  sectionPath,
} from "../../src/core/rag/chunk.ts";
import { anchorsOf, extOf, guessDate, guessTitle, slug, uniqueKey } from "../../src/core/rag/convert.ts";
import {
  cleanSpaces,
  decodeEntities,
  type HNode,
  inline,
  parseHtml,
  type RenderOpts,
  renderBlocks,
  textOf,
} from "../../src/core/rag/convert-html.ts";
import { encodePng, unpackGray1 } from "../../src/core/rag/convert-png.ts";
import { fingerprintOf, legacySpace, modelIdentity, spaceOf } from "../../src/core/rag/fingerprint.ts";
import type { CatalogEntry, DocJson, ResolvedModel } from "../../src/core/types.ts";

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

const doc = { id: "D", code: "D", title: "Doc" } as DocJson;

describe("chunks", () => {
  it("paths, token estimates and marker lookups", () => {
    expect(sectionPath("intro")).toBe("intro");
    expect(sectionPath("1.2")).toBe("1 > 1.2");
    expect(approxTokens("abcde")).toBe(2);
    expect(markerLine("a\n<!-- fig 1 -->", "1")).toBe(1);
    expect(markerLine("a\n<!-- req 1 -->", "1")).toBe(-1);
    expect(sectionAt([], -1)).toBeUndefined();
  });

  it("names figures from markers, captions without the word Figure, and figures.json entries", () => {
    const md = [
      "![Cap A](figures/fig-1.png) <!-- fig 1 -->",
      "Some pasted caption <!-- fig 2 -->",
      "Text then Figure 3 – Pompe <!-- fig 3 -->",
    ].join("\n");
    const figs = docFigures(md, [
      { anchor: "fig:1", file: "", caption: "", description: "d1" },
      { anchor: "fig:9", file: "", caption: "", description: "" },
    ]);
    expect(figs).toEqual([
      { n: "1", anchor: "fig:1", file: "figures/fig-1.png", caption: "Cap A", description: "d1" },
      { n: "2", anchor: "fig:2", file: "", caption: "Some pasted caption", description: "" },
      { n: "3", anchor: "fig:3", file: "", caption: "Figure 3 – Pompe", description: "" },
      { n: "9", anchor: "fig:9", file: "", caption: "", description: "" },
    ]);
  });

  it("cuts long lists by lines and long tables with their header repeated", () => {
    const list = Array.from({ length: 200 }, (_, i) => `- item number ${i} with a long enough text to weigh`).join(
      "\n",
    );
    const table = [
      "| A | B |",
      "| --- | --- |",
      ...Array.from({ length: 200 }, (_, i) => `| row ${i} | some cell text long enough |`),
    ].join("\n");
    const huge = `| ${"mot ".repeat(1000)}|`;
    const md = `# 1 One <!-- § 1 -->\n\n${list}\n\n# 2 Two <!-- § 2 -->\n\n${table}\n\n# 3 Three <!-- § 3 -->\n\n${huge}\n`;
    const chunks = chunkDoc(doc, md, []);
    expect(chunks.filter((c) => c.anchor === "§3").map((c) => c.text)).toEqual([huge]);
    const one = chunks.filter((c) => c.anchor === "§1");
    const two = chunks.filter((c) => c.anchor === "§2");
    expect(one.length).toBeGreaterThan(1);
    expect(two.length).toBeGreaterThan(1);
    for (const c of [...one, ...two]) expect(approxTokens(c.text)).toBeLessThanOrEqual(MAX_TOKENS + 20);
    for (const c of two) expect(c.text.startsWith("| A | B |\n| --- | --- |")).toBe(true);
  });

  it("keeps a table in its section's chunk, drops other comments from the text, and heads a figure outside sections with the doc", () => {
    const md = [
      "![Logo](figures/fig-0.png) <!-- fig 0 -->",
      "",
      "# 1 Titre <!-- § 1 -->",
      "",
      "<!-- req EXI_X_3 -->",
      "Body.",
      "",
      "| Code | Objet | Chapitre |",
      "| --- | --- | --- |",
      "| EXI_X_3 | Trois. | 1 |",
    ].join("\n");
    const chunks = chunkDoc(doc, md, []);
    expect(chunks.map((c) => [c.anchor, c.kind])).toEqual([
      ["§1", "section"],
      ["fig:0", "figure"],
    ]);
    expect(chunks[0].text).toBe("Body.\n\n| Code | Objet | Chapitre |\n| --- | --- | --- |\n| EXI_X_3 | Trois. | 1 |");
    expect(chunks.find((c) => c.anchor === "fig:0")).toMatchObject({ path: "", header: "D Doc" });
  });
});

const entry = (over: Partial<CatalogEntry> = {}): CatalogEntry =>
  ({
    id: "m1",
    pooling: undefined,
    normalize: undefined,
    queryInstruction: "Q {task}",
    docInstruction: "",
    dims: 8,
    maxInputTokens: 512,
    source: {},
    ...over,
  }) as CatalogEntry;

const model = (over: Partial<ResolvedModel> = {}, e: Partial<CatalogEntry> = {}): ResolvedModel =>
  ({
    entry: entry(e),
    install: { model: "m1", via: "path", runtime: "transformers", status: "installed" },
    runtime: "transformers",
    device: "cpu",
    queryTask: "find",
    ...over,
  }) as ResolvedModel;

const fakeDb = (rows: unknown[]) =>
  ({
    prepare: (sql: string) => ({ all: () => rows, get: () => (sql.includes("where id") ? undefined : rows[0]) }),
  }) as unknown as DatabaseSync;

describe("fingerprint identity", () => {
  it("prefers the file hash, then the install hash, then the weights, then the repo", () => {
    expect(modelIdentity(model({ install: { sha256: "abc" } as ResolvedModel["install"] }))).toBe("sha256:abc");
    expect(modelIdentity(model({}, { source: { hf: { repo: "r/x", revision: "v1" } } }))).toBe("hf:r/x@v1:?");
    expect(modelIdentity(model({ dtype: "q8" }))).toBe("hf:m1@?:q8");
    const files = [
      { path: "onnx/model.onnx", sha256: "b", size: 1 },
      { path: "onnx/model_quantized.onnx", sha256: "sha256:a", size: 1 },
      { path: "tokenizer.json", sha256: "c", size: 1 },
    ];
    const hf = { repo: "r", revision: "v", files };
    expect(modelIdentity(model({ dtype: "q8" }, { source: { hf } }))).toBe("sha256:a");
    expect(modelIdentity(model({ dtype: "bnb4" }, { source: { hf } }))).toBe("sha256:b+sha256:a");
    expect(modelIdentity(model({}, { source: { hf } }))).toBe("sha256:b+sha256:a");
  });

  it("defaults pooling and normalization and reads installed dimensions", () => {
    const fp = fingerprintOf(model({ install: { dims: 4 } as ResolvedModel["install"] }));
    expect(fp).toMatchObject({ pooling: "", normalize: true, dims: 4, queryInstruction: "Q find" });
  });

  it("finds a legacy space only for an in-process runtime with the same model and dimension", () => {
    const space = {
      id: "s",
      fingerprint: JSON.stringify({ unpinned: true }),
      model_id: "old",
      dims: 8,
      built_at: null,
      complete: 1,
      last_used: null,
    };
    const db = fakeDb([space]);
    expect(legacySpace(db, model({ runtime: "llamacpp" }))).toBeUndefined();
    expect(legacySpace(db, model())).toBeUndefined();
    expect(legacySpace(db, model({}, { legacyProfile: "old" }))?.id).toBe("s");
    expect(spaceOf(db, model({ runtime: "mock" }, { legacyProfile: "old" }))?.id).toBe("s");
    expect(legacySpace(fakeDb([{ ...space, dims: 4 }]), model({}, { legacyProfile: "old" }))).toBeUndefined();
  });
});
