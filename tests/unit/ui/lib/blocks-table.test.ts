import { describe, expect, it } from "vitest";
import type { Step } from "../../../../src/core/types.ts";
import { blankStep, blocksOf, hasRawEmbed, imageRef, leafBlocks } from "../../../../src/ui/lib/blocks.ts";
import { addCol, addRow, dropCol, dropRow, NEW_TABLE, tablesIn, width } from "../../../../src/ui/lib/table.ts";

const cellsOf = (text: string) => tablesIn(text).map((t) => t.rows.map((r) => r.cells.map((c) => c.text)));

describe("ui table", () => {
  it("reads a header row, body rows, cells over several lines and embeds holding a pipe", () => {
    const text = "Intro\n||A||B||\n|x|line 1\n* item|\n|!blob:u|width=2!|z|\n\nAfter";
    expect(cellsOf(text)).toEqual([
      [
        ["A", "B"],
        ["x", "line 1\n* item"],
        ["!blob:u|width=2!", "z"],
      ],
    ]);
    const [t] = tablesIn(text);
    expect(t.rows[0].head).toBe(true);
    expect(t.rows[1].head).toBe(false);
    expect(text.slice(t.at, t.end)).toBe("||A||B||\n|x|line 1\n* item|\n|!blob:u|width=2!|z|");
  });

  it("reads rows without a closing pipe and a lone pipe", () => {
    expect(cellsOf("|a|b")).toEqual([[["a", "b"]]]);
    expect(cellsOf("|")).toEqual([[[""]]]);
    expect(cellsOf("no table here")).toEqual([]);
  });

  it("finds two tables separated by a blank line", () => {
    expect(cellsOf("|a|\n\n|b|")).toEqual([[["a"]], [["b"]]]);
  });

  it("measures the widest row", () => {
    expect(width(tablesIn("|a|b|c|\n|d|")[0])).toBe(3);
  });

  it("adds a row as wide as the table", () => {
    const text = "||H1||H2||\n|a|b|\n\ntail";
    expect(addRow(text, tablesIn(text)[0])).toBe("||H1||H2||\n|a|b|\n| | |\n\ntail");
  });

  it("drops the only row, the first row and a later row", () => {
    const one = "x\n\n|a|b|\n\ny";
    expect(dropRow(one, tablesIn(one)[0], 0)).toBe("x\n\n\n\ny");
    const two = "||H||\n|a|\n|b|";
    const t = tablesIn(two)[0];
    expect(dropRow(two, t, 0)).toBe("|a|\n|b|");
    expect(dropRow(two, t, 2)).toBe("||H||\n|a|");
  });

  it("adds a column to header and body rows", () => {
    const text = "||H||\n|a|";
    expect(addCol(text, tablesIn(text)[0])).toBe("||H|| ||\n|a| |");
  });

  it("drops the only column, the last column, a middle column and skips short rows", () => {
    const single = "|a|\n|b|";
    expect(dropCol(single, tablesIn(single)[0], 0)).toBe("");
    const text = "||H1||H2||H3||\n|a|b|c|\n|d|";
    const t = tablesIn(text)[0];
    expect(dropCol(text, t, 2)).toBe("||H1||H2||\n|a|b|\n|d|");
    expect(dropCol(text, t, 1)).toBe("||H1||H3||\n|a|c|\n|d|");
  });

  it("offers a two-column starter table", () => {
    expect(cellsOf(NEW_TABLE)).toEqual([
      [
        ["Heading", "Heading"],
        [" ", " "],
      ],
    ]);
  });
});

describe("ui blocks", () => {
  const images = [{ file: "images/a.png" }, { file: "images/b.png" }];

  it("writes an image reference with or without params", () => {
    expect(imageRef("images/a.png")).toBe("![](images/a.png)");
    expect(imageRef("images/a.png", "width=10")).toBe('![](images/a.png "width=10")');
  });

  it("splits a field into text, image, extern, raw and table blocks with their offsets", () => {
    const text = [
      "First paragraph",
      '![](images/a.png "width=10")',
      "![](images/unknown.png)",
      '!https://x.example/p.png|alt="shot"!',
      "!https://x.example/q.png!",
      "!xray-attachment://42!",
      "|c1|c2|",
      "Last",
    ].join("\n\n");
    const blocks = blocksOf(text, images);
    expect(blocks.map((b) => b.kind)).toEqual(["text", "image", "text", "extern", "extern", "raw", "table", "text"]);
    for (const b of blocks) expect(b.end).toBeGreaterThanOrEqual(b.at);
    const [first, image, unknown, extern, bare, raw, , last] = blocks;
    expect(first).toMatchObject({ text: "First paragraph", at: 0 });
    expect(image).toMatchObject({ image: images[0], params: "width=10" });
    expect(unknown).toMatchObject({ text: "![](images/unknown.png)" });
    expect(extern).toMatchObject({ url: "https://x.example/p.png", params: 'alt="shot"' });
    expect(bare).toMatchObject({ params: "" });
    expect(raw).toMatchObject({ text: "!xray-attachment://42!" });
    expect(last).toMatchObject({ text: "Last", end: text.length });
  });

  it("returns nothing for an empty or blank field", () => {
    expect(blocksOf("", images)).toEqual([]);
    expect(blocksOf("\n\n  ", images)).toEqual([]);
  });

  it("keeps a single newline before a block and the spaces typed at the edges", () => {
    const text = "a\n![](images/a.png)\nb ";
    const blocks = blocksOf(text, images);
    expect(blocks.map((b) => (b.kind === "text" ? b.text : b.kind))).toEqual(["a", "image", "b "]);
  });

  it("flattens table cells into leaf blocks at field offsets and spots raw embeds", () => {
    const text = "|![](images/b.png)|\n|!xray-attachment://1!|";
    const leaves = leafBlocks(text, images);
    expect(leaves.map((b) => b.kind)).toEqual(["image", "raw"]);
    expect(text.slice(leaves[1].at, leaves[1].end)).toBe("!xray-attachment://1!");
    const step: Step = { fields: { Action: "plain", Data: text }, sources: [], images };
    expect(hasRawEmbed(step)).toBe(true);
    expect(hasRawEmbed({ ...step, fields: { Action: "plain" } })).toBe(false);
  });

  it("makes a blank step", () => {
    expect(blankStep()).toEqual({ fields: {}, sources: [], images: [] });
  });
});
