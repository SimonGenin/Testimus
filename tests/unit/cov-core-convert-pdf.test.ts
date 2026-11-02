import { describe, expect, it, vi } from "vitest";

type Img = { width: number; height: number; kind?: number; data?: Uint8Array };
type FakePage = {
  height?: number;
  items: unknown[];
  styles?: Record<string, { fontFamily: string }>;
  ops?: [string, unknown[]][];
  objs?: Record<string, Img | "throw">;
};

const state = vi.hoisted(() => ({ pages: [] as FakePage[], destroyed: 0 }));

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async (importOriginal) => {
  const real = await importOriginal<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>();
  const ops = real.OPS as unknown as Record<string, number>;
  const store = (objs: FakePage["objs"]) => ({
    get(id: string, cb: (v: unknown) => void) {
      const v = objs?.[id];
      if (v === "throw") throw new Error("no such object");
      cb(v);
    },
  });
  return {
    ...real,
    getDocument: () => {
      const pages = state.pages;
      return {
        promise: Promise.resolve({
          numPages: pages.length,
          getPage: async (n: number) => {
            const p = pages[n - 1];
            return {
              view: [0, 0, 595, p.height ?? 842],
              getTextContent: async () => ({ items: p.items, styles: p.styles ?? {} }),
              getOperatorList: async () => ({
                fnArray: (p.ops ?? []).map(([fn]) => ops[fn]),
                argsArray: (p.ops ?? []).map(([, args]) => args),
              }),
              objs: store(p.objs),
              commonObjs: store(p.objs),
              cleanup() {},
            };
          },
        }),
        destroy: async () => {
          state.destroyed++;
        },
      };
    },
  };
});

const { convertPdf, pdfFigures } = await import("../../src/core/rag/convert-pdf.ts");

type T = { size?: number; d?: number; height?: number; width?: number | null; font?: string; eol?: boolean };
const t = (str: string, x: number, y: number, o: T = {}) => {
  const size = o.size ?? 10;
  return {
    str,
    transform: [size, 0, 0, o.d ?? size, x, y],
    width: o.width === null ? undefined : (o.width ?? str.length * size * 0.5),
    height: o.height ?? size,
    fontName: o.font ?? "F1",
    hasEOL: o.eol ?? true,
  };
};
const rgb = (w = 2, h = 2): Img => ({ width: w, height: h, kind: 2, data: new Uint8Array(w * h * 3).fill(200) });
const draw = (id: string, x: number, y: number, w: number, h: number): [string, unknown[]][] => [
  ["save", []],
  ["transform", [w, 0, 0, h, x, y]],
  ["paintImageXObject", [id]],
  ["restore", []],
];
const chrome = (n: number) => [t(`Société X — page ${n}`, 72, 820)];
const logo = draw("g_logo", 500, 790, 50, 30);

function bigDoc(): FakePage[] {
  const page1: FakePage = {
    styles: { F2: { fontFamily: "Arial-Bold" } },
    items: [
      ...chrome(1),
      { type: "beginMarkedContent" },
      t("Spécification fonctionnelle 03/04/2026", 72, 800),
      t("1 Introduction", 72, 760, { size: 16 }),
      t("Premier paragraphe", 72, 740),
      t("suite du paragraphe", 72, 728),
      t("Nouveau paragraphe", 72, 690),
      t("• point un", 72, 676),
      t("o point deux", 72, 664),
      t("2) point trois", 72, 652),
      t("alpha ", 72, 640, { eol: false, width: 30 }),
      t("beta", 200, 640, { eol: false, width: 20 }),
      t("gamma", 220.5, 640, { eol: false, width: 25 }),
      t(" delta", 245, 640, { eol: false, width: 25 }),
      t("epsilon", 400, 640, { width: null }),
      t("1.1 Portée", 72, 620, { font: "F2" }),
      t("1.3 Saut", 72, 600, { font: "F2" }),
      t("sans taille", 72, 580, { d: 0, height: 0 }),
      t("hauteur douze", 72, 566, { d: 0, height: 12 }),
      t("Voir le schéma Figure 3 - Pompe [A]", 72, 500),
      t("Figure 4 - Second", 72, 450),
    ],
    ops: [
      ...logo,
      ...draw("img_small", 300, 512, 60, 40),
      ...draw("img_big", 72, 512, 200, 100),
      ...draw("img_small2", 400, 512, 60, 40),
      ...draw("img_four", 72, 460, 100, 30),
    ],
    objs: { g_logo: rgb(), img_big: rgb(), img_small: rgb(), img_small2: rgb(), img_four: rgb() },
  };
  const page2: FakePage = {
    items: [
      ...chrome(2),
      t("Annexe générale", 72, 780, { size: 16 }),
      t("EXI_A_1 Grand", 72, 760, { size: 16 }),
      t("Fin de phrase.", 72, 740, { size: 16 }),
      t("Annexe générale", 72, 720, { size: 16 }),
      t("Figure 7 : Schéma vectoriel", 72, 700),
      t("texte sous la figure", 72, 300),
    ],
    ops: [
      ...logo,
      ["restore", []],
      ["paintFormXObjectEnd", []],
      [
        "paintFormXObjectBegin",
        [
          [1, 0, 0, 1, 0, 0],
          [0, 0, 1, 1],
        ],
      ],
      ...draw("img_loose", 72, 400, 200, 100),
      ["paintFormXObjectEnd", []],
      ["paintFormXObjectBegin", [null]],
      ...draw("img_mid", 72, 340, 35, 25),
      ...draw("img_tiny", 72, 320, 10, 10),
      ["paintFormXObjectEnd", []],
      ["save", []],
      ["transform", [100, 0, 0, 50, 300, 100]],
      ["paintInlineImageXObject", [{ width: 8, height: 1, kind: 1, data: new Uint8Array([0b10101010]) }]],
      ["restore", []],
      ...draw("img_rgba", 300, 200, 100, 50),
      ...draw("img_kind9", 300, 260, 100, 50),
      ...draw("img_nodata", 300, 270, 100, 50),
      ...draw("img_throw", 300, 280, 100, 50),
      ...draw("img_missing", 300, 290, 100, 50),
    ],
    objs: {
      g_logo: rgb(),
      img_loose: rgb(),
      img_mid: rgb(),
      img_tiny: rgb(),
      img_rgba: { width: 1, height: 1, kind: 3, data: new Uint8Array([1, 2, 3, 4]) },
      img_kind9: { width: 1, height: 1, kind: 9, data: new Uint8Array([1]) },
      img_nodata: { width: 1, height: 1, kind: 2 },
      img_throw: "throw",
    },
  };
  const toc = Array.from({ length: 8 }, (_, i) => t(`${i + 1} Chapitre ${i + 1} ........ ${i + 3}`, 72, 780 - i * 14));
  const page3: FakePage = { items: [...chrome(3), ...toc], ops: logo, objs: { g_logo: rgb() } };
  const page4: FakePage = {
    items: [
      ...chrome(4),
      t("2 Suite", 72, 780, { size: 16 }),
      t("2.1 Détail", 72, 760, { font: "F2" }),
      t("Corps.", 72, 740),
      t("3.1 Saut direct", 72, 720, { font: "F2" }),
      t("Grand titre", 72, 700, { size: 20 }),
    ],
    styles: { F2: { fontFamily: "Helvetica-Black" } },
    ops: logo,
    objs: { g_logo: rgb() },
  };
  return [page1, page2, page3, page4];
}

describe("convertPdf over a scripted pdf.js", () => {
  it("reads lines, headings, bullets, figures and drops page chrome, logos and tables of contents", async () => {
    state.pages = bigDoc();
    const c = await convertPdf(new Uint8Array(), { code: "DOC" });
    const md = c.md;
    expect(md.startsWith("# DOC — Spécification fonctionnelle 03/04/2026\n")).toBe(true);
    expect(c.meta).toEqual({ title: "Spécification fonctionnelle 03/04/2026", date: "2026-04-03" });
    expect(md).not.toContain("Société X");
    expect(md).not.toContain("Chapitre 3");
    expect(md).toContain("## 1 Introduction <!-- § 1 -->");
    expect(md).toContain("Premier paragraphe suite du paragraphe\n\nNouveau paragraphe");
    expect(md).toContain("- point un\n\n- point deux\n\n- point trois");
    expect(md).toContain("alpha betagamma delta epsilon");
    expect(md).toContain("### 1.1 Portée <!-- § 1.1 -->");
    expect(md).toContain("1.3 Saut");
    expect(md).not.toContain("1.3 Saut <!--");
    expect(md).toContain("sans taille hauteur douze");
    expect(md).toContain("Voir le schéma\n\n![Figure 3 - Pompe \\[A\\]](figures/fig-3.png) <!-- fig 3 -->");
    expect(md).toContain("![Figure 4 - Second](figures/fig-4.png) <!-- fig 4 -->");
    expect(md).toContain("### Annexe générale <!-- § annexe-generale -->");
    expect(md).toContain("### Annexe générale <!-- § annexe-generale-2 -->");
    expect(md).toContain("### 3.1 Saut direct <!-- § 3.1 -->");
    expect(md).toContain("## Grand titre <!-- § grand-titre -->");
    expect(md).toContain("<!-- req EXI_A_1 -->\nEXI_A_1 Grand");
    expect(md).not.toContain("Fin de phrase. <!--");
    expect(md).toContain("Figure 7 : Schéma vectoriel <!-- fig 7 -->");
    expect(md).toContain("![](figures/fig-f1.png) <!-- fig f1 -->");
    expect(md).toContain("## 2 Suite <!-- § 2 -->");
    expect(md).toContain("### 2.1 Détail <!-- § 2.1 -->");
    expect(c.figures.map((f) => f.key)).toEqual(["3", "4", "f1", "f2", "f3"]);
    expect(c.warnings).toEqual([
      "4 pictures in the PDF could not be extracted",
      "2 small pictures dropped (icons, or text drawn as a picture)",
      "2 extra pictures above a caption dropped (only the largest is kept)",
      "Figure 7: caption without an extractable picture (vector drawing)",
      "Converted from PDF: headings are guessed from their numbering, tables are flattened to text",
    ]);
    expect(c.convertedWith).toMatch(/^pdfjs-dist \d/);
  });

  it("gives only the captioned figures that have a picture", async () => {
    state.pages = bigDoc();
    const figs = await pdfFigures(new Uint8Array());
    expect(figs.map((f) => [f.key, f.caption])).toEqual([
      ["3", "Figure 3 - Pompe [A]"],
      ["4", "Figure 4 - Second"],
    ]);
  });

  it("says each dropped picture in the singular", async () => {
    state.pages = [
      {
        items: [t("Figure 1 - Un", 72, 500), t("Figure 1 .... 4", 72, 400)],
        ops: [
          ...draw("a", 72, 520, 100, 50),
          ...draw("b", 200, 520, 50, 30),
          ...draw("c", 72, 100, 35, 25),
          ...draw("d", 72, 50, 100, 50),
        ],
        objs: { a: rgb(), b: rgb(), c: rgb() },
      },
    ];
    const c = await convertPdf(new Uint8Array(), { code: "ONE" });
    expect(c.warnings.slice(0, 3)).toEqual([
      "1 picture in the PDF could not be extracted",
      "1 small picture dropped (icons, or text drawn as a picture)",
      "1 extra picture above a caption dropped (only the largest is kept)",
    ]);
    expect(c.md).toContain("Figure 1 .... 4");
  });

  it("converts an empty document under its code", async () => {
    state.pages = [];
    const c = await convertPdf(new Uint8Array(), { code: "EMPTY", reqPatterns: ["REQ-\\d+"] });
    expect(c.md).toBe("# EMPTY — EMPTY\n");
    expect(c.meta).toEqual({ title: "", date: "" });
  });

  it("stops between pages when cancelled and still releases the document", async () => {
    state.pages = bigDoc();
    const before = state.destroyed;
    await expect(convertPdf(new Uint8Array(), { code: "X", signal: AbortSignal.abort() })).rejects.toThrow(
      "Cancelled.",
    );
    expect(state.destroyed).toBe(before + 1);
  });
});
