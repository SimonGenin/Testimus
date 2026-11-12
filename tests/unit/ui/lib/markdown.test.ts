import { describe, expect, it } from "vitest";
import { parseAnswer, parseBlocks, parseInline, plainText, sourcesOf } from "../../../../src/ui/lib/markdown.ts";

const S = (docId: string, anchor: string, quote = "") => ({ kind: "source", source: { docId, anchor, quote } });
const T = (text: string) => ({ kind: "text", text });

describe("Markdown blocks", () => {
  it("headings # to ###, deeper ones read as ###, closing hashes and <!-- marks --> dropped", () => {
    expect(parseBlocks("# Un\n## Deux ##\n### Trois\n#### Quatre <!-- doc D1 -->")).toEqual([
      { kind: "heading", level: 1, text: "Un" },
      { kind: "heading", level: 2, text: "Deux" },
      { kind: "heading", level: 3, text: "Trois" },
      { kind: "heading", level: 3, text: "Quatre" },
    ]);
    expect(parseBlocks("#hashtag")).toEqual([{ kind: "para", text: "#hashtag" }]);
  });

  it("paragraphs split on blank lines and keep their line breaks", () => {
    expect(parseBlocks("Un\ndeux\n\n\nTrois")).toEqual([
      { kind: "para", text: "Un\ndeux" },
      { kind: "para", text: "Trois" },
    ]);
  });

  it("bullet and numbered lists, one level of nesting, a wrapped item continued, a list after a paragraph", () => {
    expect(parseBlocks("Avant :\n- a\n  - a1\n    - a2 deeper\n- b\n  suite de b\n\n3. trois\n4) quatre")).toEqual([
      { kind: "para", text: "Avant :" },
      {
        kind: "list",
        ordered: false,
        start: 1,
        items: [
          {
            text: "a",
            children: {
              kind: "list",
              ordered: false,
              start: 1,
              items: [{ text: "a1" }, { text: "a2 deeper" }],
            },
          },
          { text: "b\nsuite de b" },
        ],
      },
      { kind: "list", ordered: true, start: 3, items: [{ text: "trois" }, { text: "quatre" }] },
    ]);
    expect(parseBlocks("1. un\n\n2. deux")).toEqual([
      { kind: "list", ordered: true, start: 1, items: [{ text: "un" }, { text: "deux" }] },
    ]);
    expect(parseBlocks("* étoile\n+ plus")[0]).toMatchObject({ items: [{ text: "étoile" }, { text: "plus" }] });
  });

  it("fenced code blocks keep their text as it is, an unclosed one (a streaming answer) runs to the end", () => {
    expect(parseBlocks("```ts\nconst a = **b**;\n\n# not a title\n```\nAprès")).toEqual([
      { kind: "code", lang: "ts", text: "const a = **b**;\n\n# not a title" },
      { kind: "para", text: "Après" },
    ]);
    expect(parseBlocks("~~~\nen cours")).toEqual([{ kind: "code", lang: "", text: "en cours" }]);
  });

  it("| tables with a rule line, rows padded to the head, an escaped pipe kept", () => {
    expect(parseBlocks("| Type | Entrées |\n|:---|---:|\n| Sans TK | a \\| b |\n| Avec TK |\n\nFin")).toEqual([
      {
        kind: "table",
        head: ["Type", "Entrées"],
        rows: [
          ["Sans TK", "a | b"],
          ["Avec TK", ""],
        ],
      },
      { kind: "para", text: "Fin" },
    ]);
    expect(parseBlocks("a | b sans règle")).toEqual([{ kind: "para", text: "a | b sans règle" }]);
  });

  it("> quotes hold blocks of their own; --- is a rule", () => {
    expect(parseBlocks("> **Note**\n> - un\n\n---\nFin")).toEqual([
      {
        kind: "quote",
        blocks: [
          { kind: "para", text: "**Note**" },
          { kind: "list", ordered: false, start: 1, items: [{ text: "un" }] },
        ],
      },
      { kind: "rule" },
      { kind: "para", text: "Fin" },
    ]);
  });
});

describe("Markdown inline", () => {
  it("bold, italic, nested, and marks that are not marks (snake_case, a lone star, 2 * 3)", () => {
    expect(parseInline("**gras** et *ita* et _ita2_ et __gras2__")).toEqual([
      { kind: "strong", children: [T("gras")] },
      T(" et "),
      { kind: "em", children: [T("ita")] },
      T(" et "),
      { kind: "em", children: [T("ita2")] },
      T(" et "),
      { kind: "strong", children: [T("gras2")] },
    ]);
    expect(parseInline("**un *deux* trois**")).toEqual([
      { kind: "strong", children: [T("un "), { kind: "em", children: [T("deux")] }, T(" trois")] },
    ]);
    expect(parseInline("file_name_here, 2 * 3 * 4, **ouvert")).toEqual([T("file_name_here, 2 * 3 * 4, **ouvert")]);
  });

  it("`code` keeps its marks; links are https or mailto only, any other is its words", () => {
    expect(parseInline("lancer `rag.index --full **x**` puis")).toEqual([
      T("lancer "),
      { kind: "code", text: "rag.index --full **x**" },
      T(" puis"),
    ]);
    expect(
      parseInline("[la doc](https://example.com/a) et [ici](javascript:alert(1)) et [mail](mailto:a@b.c)"),
    ).toEqual([
      { kind: "link", href: "https://example.com/a", text: "la doc" },
      T(" et "),
      T("ici"),
      T(") et "),
      { kind: "link", href: "mailto:a@b.c", text: "mail" },
    ]);
  });

  it('every docId#anchor "quote" is a source, bracketed or not, inside bold too', () => {
    expect(parseInline('Voir [D401#§5.6.6 "le menu diffère"] et **D2#fig:3**.')).toEqual([
      T("Voir "),
      S("D401", "§5.6.6", "le menu diffère"),
      T(" et "),
      { kind: "strong", children: [S("D2", "fig:3")] },
      T("."),
    ]);
    expect(parseInline("SOSIE_211_D401-1_3#§5.6.6")).toEqual([S("SOSIE_211_D401-1_3", "§5.6.6")]);
    expect(plainText(parseInline("**a** `b` [c](https://x.y) D#§1"))).toBe("a b c D#§1");
  });

  it("the sources of a text, each once, as parseAnswer cuts them", () => {
    const text = 'A D#§1 "q" puis [D#§1 "q"] et E#t:01:02';
    expect(sourcesOf(text)).toEqual([
      { docId: "D", anchor: "§1", quote: "q" },
      { docId: "E", anchor: "t:01:02", quote: "" },
    ]);
    expect(parseAnswer("rien")).toEqual(["rien"]);
  });
});

// ponytail: an answer as the chat writes them since the ask-docs skill of 2026-11-10 — a title, the answer first, its
// sources, a list with a sub-list, a table, a quote and a command
const LONG = `## Le menu contextuel d'un sectionneur

Le menu **dépend du type** de sectionneur [SOSIE_211_D401-1_3#§5.6.6 "Selon le type de sectionneur, le menu contextuel diffère"].

### Sans télécommande (TK)

- *Propriétés*, toujours présent ;
- les commandes d'**autorisation** d'ouverture et de fermeture ;
  - puis leur **confirmation** [SOSIE_211_D401-1_3#§5.6.6 "Le menu contextuel d'un sectionneur sans TK propose"].

### Ce qu'il faut tester

1. Ouvrir le menu sur un sectionneur sans TK.
2. Vérifier les entrées, dans l'ordre affiché.

| Type | Entrées |
| --- | --- |
| Sans TK | Propriétés, autorisation, confirmation |
| Avec TK | Propriétés, commande directe |

> Les documents ne précisent pas l'ordre d'affichage des commandes.

Pour relancer l'index : \`testimus rag index\`.`;

describe("a long chat answer", () => {
  it("is cut into its titles, paragraphs, lists, table and quote — no mark left in the words", () => {
    const blocks = parseBlocks(LONG);
    expect(blocks.map((b) => b.kind)).toEqual([
      "heading",
      "para",
      "heading",
      "list",
      "heading",
      "list",
      "table",
      "quote",
      "para",
    ]);
    const sub = blocks[3].kind === "list" ? blocks[3].items[1].children?.items[0].text : "";
    expect(parseInline(sub ?? "")).toEqual([
      T("puis leur "),
      { kind: "strong", children: [T("confirmation")] },
      T(" "),
      S("SOSIE_211_D401-1_3", "§5.6.6", "Le menu contextuel d'un sectionneur sans TK propose"),
      T("."),
    ]);
    const words = blocks
      .flatMap((b) =>
        b.kind === "para" || b.kind === "heading"
          ? [b.text]
          : b.kind === "list"
            ? b.items.flatMap((i) => [i.text, ...(i.children?.items.map((c) => c.text) ?? [])])
            : b.kind === "table"
              ? [...b.head, ...b.rows.flat()]
              : [],
      )
      .map((t) => plainText(parseInline(t)))
      .join("\n");
    expect(words).not.toMatch(/\*\*|^#|^- |\|/m);
  });
});
