import { expect, test } from "vitest";
import { blocksOf, hasRawEmbed, leafBlocks } from "../../src/core/lib/testfile.ts";
import { addCol, addRow, dropCol, dropRow, tablesIn, width } from "../../src/shared/table.ts";

// the shape EGS-1165 step 3 really has: a header row, image cells, cells holding a bullet list over
// several lines, and an Xray embed whose own params carry a pipe
const EGS = `||*Visual*||*Description*||
|![](images/a.png "width=128,height=86")|State :
* No fault (normal blue color)
* Not selected (no outline)|
|![](images/b.png "width=136,height=92")|State :
* Category D fault
!blob:https://transurb.atlassian.net/788f|width=200,height=183,alt="shot.png"!
_"Yes, this cross will appear."_|

If the component has multiple fault messages, then all are listed.`;

const images = [{ file: "images/a.png" }, { file: "images/b.png" }];

const cellsOf = (text: string) => tablesIn(text).map((t) => t.rows.map((r) => r.cells.map((c) => c.text)));

test("a row is not a line — a cell holds as many lines as it likes, and the table ends at the blank one", () => {
  const [rows] = cellsOf(EGS);
  expect(rows).toEqual([
    ["*Visual*", "*Description*"],
    ['![](images/a.png "width=128,height=86")', "State :\n* No fault (normal blue color)\n* Not selected (no outline)"],
    [
      '![](images/b.png "width=136,height=92")',
      'State :\n* Category D fault\n!blob:https://transurb.atlassian.net/788f|width=200,height=183,alt="shot.png"!\n_"Yes, this cross will appear."_',
    ],
  ]);
  // the pipe inside the Xray embed is not a cell boundary
  expect(rows[2][1]).toContain("|width=200");
  expect(tablesIn(EGS)[0].rows[0].head).toBe(true);
  expect(tablesIn(EGS)[0].rows[1].head).toBe(false);
  expect(EGS.slice(tablesIn(EGS)[0].end)).toBe(
    "\n\nIf the component has multiple fault messages, then all are listed.",
  );
});

test("every cell is a slice of the field string, so editing one is a splice", () => {
  const t = tablesIn(EGS)[0];
  const c = t.rows[1].cells[1];
  expect(EGS.slice(c.at, c.end)).toBe(c.text);
  const next = EGS.slice(0, c.at) + "State : fine" + EGS.slice(c.end);
  expect(cellsOf(next)[0][1]).toEqual(['![](images/a.png "width=128,height=86")', "State : fine"]);
  // nothing else moved
  expect(cellsOf(next)[0][2]).toEqual(cellsOf(EGS)[0][2]);
});

test("rows and columns are added and dropped by splicing the same string", () => {
  const t = () => tablesIn(EGS)[0];
  expect(width(t())).toBe(2);

  const plus = addRow(EGS, t());
  expect(cellsOf(plus)[0]).toHaveLength(4);
  expect(cellsOf(plus)[0][3]).toEqual([" ", " "]);

  const wider = addCol(EGS, t());
  expect(cellsOf(wider)[0].map((r) => r.length)).toEqual([3, 3, 3]);
  expect(cellsOf(wider)[0][0]).toEqual(["*Visual*", "*Description*", " "]);

  const narrow = dropCol(EGS, t(), 0);
  expect(cellsOf(narrow)[0][0]).toEqual(["*Description*"]);
  expect(cellsOf(narrow)[0][1][0]).toContain("State :");

  const short = dropRow(EGS, t(), 0);
  expect(cellsOf(short)[0]).toHaveLength(2);
  expect(short.startsWith("|![](images/a.png")).toBe(true);

  // dropping the last row takes the table with it
  let gone = EGS;
  while (tablesIn(gone).length) gone = dropRow(gone, tablesIn(gone)[0], 0);
  expect(gone.trim()).toBe("If the component has multiple fault messages, then all are listed.");
});

test("blocksOf makes a table one block and leaves the text around it alone", () => {
  const text = "Before\n\n" + EGS;
  const bs = blocksOf(text, images);
  expect(bs.map((b) => b.kind)).toEqual(["text", "table", "text"]);
  expect(bs[0]).toMatchObject({ text: "Before" });
  expect(text.slice(bs[1].at, bs[1].end)).toBe(EGS.split("\n\nIf the component")[0]);
  // the embeds inside the table belong to its cells, not to the field
  expect(bs.some((b) => b.kind === "image" || b.kind === "extern")).toBe(false);
  expect(blocksOf(EGS.split("\n\n")[0].split("\n").slice(1, 4).join("\n"), images)).toBeDefined();
});

test("an embed Xray dropped still makes the step unpushable when it hides in a cell", () => {
  const withRaw = "||h||h||\n|a|!xray-attachment://gone|width=6,height=6!|";
  expect(blocksOf(withRaw, images).map((b) => b.kind)).toEqual(["table"]);
  expect(hasRawEmbed({ fields: { Action: withRaw }, sources: [], images })).toBe(true);
  expect(hasRawEmbed({ fields: { Action: EGS, Data: "" }, sources: [], images })).toBe(false);
});

test("a screenshot whose only ref is in a cell is embedded, not a loose attachment", () => {
  const text = 'intro\n\n||h||h||\n|![](images/a.png "width=8,height=8")|note|';
  const leaves = leafBlocks(text, images);
  expect(leaves.map((b) => b.kind)).toEqual(["text", "text", "text", "image", "text"]);
  const img = leaves.find((b) => b.kind === "image");
  expect(img).toMatchObject({ image: images[0], params: "width=8,height=8" });
  // absolute offsets: a leaf of a cell splices like any other block
  expect(text.slice(img!.at, img!.end)).toBe('![](images/a.png "width=8,height=8")');
  // which is what the step card asks to decide whether an attachment is embedded anywhere
  const embedded = leaves.flatMap((b) => (b.kind === "image" ? [b.image.file] : []));
  expect(images.filter((im) => !embedded.includes(im.file))).toEqual([images[1]]);
});
