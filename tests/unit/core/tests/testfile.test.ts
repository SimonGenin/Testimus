import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { blocksOf, hasRawEmbed, imageRef, mapRefs } from "../../../../src/core/lib/test-blocks.ts";
import {
  blankStep,
  fieldName,
  fieldWarnings,
  formatSource,
  newTest,
  parseSource,
  parseTest,
  sameTestMd,
  serializeTest,
} from "../../../../src/core/lib/testfile.ts";
import type { Step, Test } from "../../../../src/core/types.ts";

const NASTY = [
  "#hashtag first",
  "## Step 99",
  "### Action",
  "---",
  "\\---",
  "\\#already escaped",
  "\\\\#double backslash",
  "ATS User 1:\n\u25FC Log into the exercise   \n\u25FC Then wait",
  "line one\n\nline three\n   \nafter a whitespace-only line",
  "----",
  "  indented # not a heading",
  "a value with a # hash",
  "",
];

const SUMMARIES = ["R8-2506-MWS-TSR-Manage", "  padded  ", "[bracketed]", 'has "quotes"', '"fully quoted"', ""];
const FOLDERS = ["/Release 8.0", "/", "  /odd  ", "/a # b"];
const REVIEW = ["draft", "checked", "to-fix", "validated"] as const;

const step3 = (action: string, data: string, result: string, rest: Partial<Step> = {}): Step => ({
  fields: { Action: action, Data: data, "Expected Result": result },
  sources: [],
  images: [],
  ...rest,
});

const mk = (i: number): Test => ({
  key: i % 2 ? "BHPTCC-" + (2000 + i) : undefined,
  preconditions: i % 4 ? ["BHPTCC-" + (1900 + i), "BHPTCC-1899"] : [],
  project: "BHPTCC",
  summary: SUMMARIES[i % SUMMARIES.length],
  folder: FOLDERS[i % FOLDERS.length],
  labels: i % 3 ? ["bhp", "test"] : [],
  status: i % 2 ? "To Do" : undefined,
  description: NASTY[i % NASTY.length],
  covers: i % 4 === 0 ? [] : ["BHPTCC-2174", "BHPTCC-2175"],
  clonedFrom: i % 5 === 0 ? "BHPTCC-2083" : undefined,
  review: REVIEW[i % 4],
  reviewNote: i % 4 === 2 ? 'Step 2: "Propriétés" only # really' : undefined,
  reviewedBy: i % 4 > 1 ? "tester" : undefined,
  reviewedAt: i % 4 > 1 ? "2026-10-28T11:00:00.000Z" : undefined,
  generatedBy: i % 3 === 1 ? "gen-tests-1a2b3c4d" : undefined,
  steps: Array.from({ length: i % 4 }, (_, n) => ({
    id: n % 2 ? "6a1f0c2e-000" + n : undefined,
    fields: {
      Action:
        NASTY[(i + n) % NASTY.length] + (n % 3 === 0 ? "" : '\n\n![](images/img-3f2a9c1d.png "width=320,height=200")'),
      Data: NASTY[(i + n + 1) % NASTY.length],
      "Expected Result": NASTY[(i + n + 2) % NASTY.length],
      ...(n % 2 ? { Exigence: "EXI_MOP_SPF_511_A_1670, EXI_MOP_SPF_510_A_20" } : {}),
    },
    sources:
      n % 2
        ? [
            { docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6", quote: "Selon le type de sectionneur" },
            { docId: "SOSIE_211_D401-1_3", anchor: "req:EXI_MOP_SPF_511_A_1670", quote: 'le "menu" propose' },
          ]
        : [],
    images:
      n % 3 === 0
        ? []
        : [
            ...(n % 2 ? [{ file: "images/img-0a11b2c3.png" }] : []),
            { file: "images/img-3f2a9c1d.png", remoteId: "10412" },
            { file: "images/img-77b0e1aa.png" },
          ],
  })),
  extra: i % 3 === 0 ? { custom_key: "kept", empty_key: "" } : {},
});

test("serialize is a fixed point of parse for 24 generated tests", () => {
  for (let i = 0; i < 24; i++) {
    const once = serializeTest(mk(i));
    const { test: back, warnings } = parseTest(once);
    expect(warnings, "test " + i).toEqual([]);
    expect(serializeTest(back), "test " + i).toBe(once);
  }
});

test("step text survives the round trip byte for byte", () => {
  for (const text of NASTY) {
    const fields = { Action: text, Data: text, "Expected Result": text, Exigence: text };
    const t: Test = { ...newTest("P", "/"), steps: [{ fields, sources: [], images: [] }] };
    const { test: back } = parseTest(serializeTest(t));
    for (const f of ["Action", "Data", "Expected Result", "Exigence"]) expect(back.steps[0].fields[f] ?? "").toBe(text);
  }
});

test("serialized output is exactly the format of SPEC section 6", () => {
  const t: Test = {
    key: "BHPTCC-2234",
    project: "BHPTCC",
    summary: "R8-2506-MWS-TSR-Manage",
    folder: "/Release 8.0",
    labels: ["bhp", "test"],
    status: "To Do",
    covers: ["BHPTCC-2174", "BHPTCC-2175"],
    clonedFrom: "BHPTCC-2083",
    preconditions: ["BHPTCC-2075", "BHPTCC-2077"],
    review: "to-fix",
    reviewNote: "Step 2: wrong menu",
    reviewedBy: "tester",
    reviewedAt: "2026-10-31T15:20:00.000Z",
    generatedBy: "gen-tests-1a2b3c4d",
    description: "Test steps are based on the following item/s:\nBHPTCC-2174 - MWS TSR delete",
    steps: [
      {
        id: "6a1f0c2e",
        fields: {
          "Expected Result": "ATS1: Is logged in as ATS Operator",
          Exigence: "EXI_1",
          Action: "ATS User 1:\n\u25FC Log into the simulation exercise\n\n![](images/img-0a11b2c3.png)",
          Data: "",
        },
        sources: [{ docId: "DOC_1", anchor: "§5.6.6", quote: "Selon le type" }],
        images: [
          { file: "images/img-0a11b2c3.png" },
          { file: "images/img-3f2a9c1d.png", remoteId: "10412" },
          { file: "images/img-77b0e1aa.png" },
        ],
      },
      { fields: { Action: "Open the TSR list", Data: "" }, sources: [], images: [] },
    ],
    extra: {},
  };
  expect(serializeTest(t, ["Action", "Data", "Expected Result", "Exigence"])).toBe(
    `---
key: BHPTCC-2234
project: BHPTCC
summary: R8-2506-MWS-TSR-Manage
folder: /Release 8.0
labels: [bhp, test]
status: To Do
covers: [BHPTCC-2174, BHPTCC-2175]
cloned_from: BHPTCC-2083
preconditions: [BHPTCC-2075, BHPTCC-2077]
review: to-fix
review_note: "Step 2: wrong menu"
reviewed_by: tester
reviewed_at: 2026-10-31T15:20:00.000Z
generated_by: gen-tests-1a2b3c4d
---

## Description

Test steps are based on the following item/s:
BHPTCC-2174 - MWS TSR delete

## Step 1 <!-- 6a1f0c2e -->

### Action

ATS User 1:
\u25FC Log into the simulation exercise

![](images/img-0a11b2c3.png)

### Expected Result

ATS1: Is logged in as ATS Operator

### Exigence

EXI_1

### Sources

- DOC_1#§5.6.6 "Selon le type"

### Attachments

- images/img-0a11b2c3.png
- images/img-3f2a9c1d.png <!-- 10412 -->
- images/img-77b0e1aa.png

## Step 2

### Action

Open the TSR list
`,
  );
});

const LEGACY = `---
key: DEMO-5
project: DEMO
summary: A test written before the sections existed
folder: /Release 8.0
---

## Step 1 <!-- s1 -->

### Action

Do it

### Attachments

- images/img-3f2a9c1d.png <!-- 10412 -->
- images/img-77b0e1aa.png

### Expected

It works

## Step 2

### Action

Again

### Data

d
`;

test("the attachments list opens as the step attachments and round-trips", () => {
  const { test: v1, warnings } = parseTest(LEGACY);
  expect(warnings).toEqual([]);
  expect(v1.steps[0].images).toEqual([
    { file: "images/img-3f2a9c1d.png", remoteId: "10412" },
    { file: "images/img-77b0e1aa.png" },
  ]);

  const md = serializeTest(v1);
  expect(md).toContain("### Attachments");
  expect(md.indexOf("### Expected Result\n")).toBeLessThan(md.indexOf("### Attachments"));

  const { test: v2, warnings: again } = parseTest(md);
  expect(again).toEqual([]);
  expect(v2).toEqual(v1);
  expect(serializeTest(v2)).toBe(md);
});

const ATT = "### Attachments\n\n";

test("attachments are listed once, in Xray order, and an empty list is not written", () => {
  const t: Test = {
    ...newTest("DEMO", "/"),
    steps: [
      step3("a", "", "r", {
        images: [
          { file: "images/act-1.png" },
          { file: "images/act-2.png", remoteId: "att-2" },
          { file: "images/exp-1.png" },
        ],
      }),
      step3("b", "", "", { images: [{ file: "images/exp-2.png" }] }),
    ],
  };
  const md = serializeTest(t);
  expect(md).toContain(ATT + "- images/act-1.png\n- images/act-2.png <!-- att-2 -->\n- images/exp-1.png\n");
  expect(md.split("### Attachments")).toHaveLength(3);
  const { test: back, warnings } = parseTest(md);
  expect(warnings).toEqual([]);
  expect(back.steps[0].images).toEqual(t.steps[0].images);
  expect(back.steps[1].images).toEqual(t.steps[1].images);
});

test("an attachment names the document figure it was copied from, before its Xray id", () => {
  const images = [
    { file: "images/img-1.png", figure: "SOSIE_211_D401-1_3#fig:40" },
    { file: "images/img-2.png", remoteId: "att-2", figure: "DOC#fig:f16" },
    { file: "images/img 3 (copy).png" },
  ];
  const md = serializeTest({ ...newTest("DEMO", "/"), steps: [step3("a", "", "r", { images })] });
  expect(md).toContain(
    `${ATT}- images/img-1.png (SOSIE_211_D401-1_3#fig:40)\n- images/img-2.png (DOC#fig:f16) <!-- att-2 -->\n- images/img 3 (copy).png\n`,
  );
  const { test: back, warnings } = parseTest(md);
  expect(warnings).toEqual([]);
  expect(back.steps[0].images).toEqual(images);
});

test("text lines that look like markdown structure are escaped", () => {
  const t: Test = {
    ...newTest("P", "/"),
    description: "---",
    steps: [step3("# title\n## Step 99\nplain\n---", "", "\\#kept")],
  };
  const md = serializeTest(t);
  expect(md).toContain("\\---\n\n## Step 1");
  expect(md).toContain("\\# title\n\\## Step 99\nplain\n\\---");
  expect(md).toContain("\\\\#kept");
  const { test: back, warnings } = parseTest(md);
  expect(warnings).toEqual([]);
  expect(back.description).toBe("---");
  expect(back.steps).toHaveLength(1);
  expect(back.steps[0].fields.Action).toBe("# title\n## Step 99\nplain\n---");
  expect(back.steps[0].fields["Expected Result"]).toBe("\\#kept");
});

test("frontmatter is quoted only when the value needs it", () => {
  const md = serializeTest({ ...newTest("P", "  /odd  "), summary: "[x] # y", labels: ["a", "b"] });
  expect(md).toContain('summary: "[x] # y"');
  expect(md).toContain('folder: "  /odd  "');
  expect(md).toContain("labels: [a, b]");
  expect(serializeTest({ ...newTest("P", "/Release 8.0"), summary: "plain summary" })).toContain(
    "summary: plain summary",
  );
  const { test: back } = parseTest(md);
  expect(back.summary).toBe("[x] # y");
  expect(back.folder).toBe("  /odd  ");
  expect(back.labels).toEqual(["a", "b"]);
});

test("unknown frontmatter keys are preserved and steps are renumbered", () => {
  const { test: t, warnings } = parseTest(
    `---
project: DEMO
summary: S
folder: /
jira_epic: DEMO-7
owner: "  me  "
---

## Step 7

### Action

seven

## Step 3

### Action

three
`,
  );
  expect(warnings).toEqual([]);
  expect(t.extra).toEqual({ jira_epic: "DEMO-7", owner: "  me  " });
  const md = serializeTest(t);
  expect(md).toContain("## Step 1");
  expect(md).toContain("## Step 2");
  expect(md).not.toContain("## Step 7");
  expect(md).toContain("jira_epic: DEMO-7");
  expect(md).toContain('owner: "  me  "');
});

test("the parser is tolerant and reports what it could not use", () => {
  const { test: t, warnings } = parseTest(
    `---
key: DEMO-9
project : DEMO
summary : Messy   test
labels: [a,b]
oops
---
Preamble line.

## step
### action
Do it
### expected
It works

### images
- images/x.png <!-- 42 -->
images/y.png

## STEP 2 <!--  s2  -->

### Action

Second

## Notes

dropped

## Step 3
### Data
only data
`,
  );
  expect(t).toMatchObject({
    key: "DEMO-9",
    project: "DEMO",
    summary: "Messy   test",
    labels: ["a", "b"],
    description: "Preamble line.",
  });
  expect(t.steps).toHaveLength(3);
  expect(t.steps[0].fields).toEqual({ Action: "Do it", "Expected Result": "It works" });
  expect(t.steps[0].images).toEqual([{ file: "images/x.png", remoteId: "42" }, { file: "images/y.png" }]);
  expect(t.steps[1]).toMatchObject({ id: "s2", fields: { Action: "Second" } });
  expect(t.steps[2].fields).toEqual({ Data: "only data" });
  expect(warnings).toEqual([
    'Kept frontmatter line "oops" as written (expected "key: value")',
    "Text before the first section was kept as the description",
    'Image line without a "- " bullet: "images/y.png"',
    'Kept unknown section "## Notes" as written',
  ]);
});

test("CRLF, a BOM and a missing frontmatter are handled", () => {
  const { test: t, warnings } = parseTest("\uFEFF## Step 1\r\n\r\n### Action\r\n\r\na\r\nb\r\n");
  expect(t.steps[0].fields.Action).toBe("a\nb");
  expect(t.project).toBe("");
  expect(warnings).toEqual(["No frontmatter — key, project and folder are unknown"]);
  expect(parseTest("---\nproject: P\nsummary: S\n").warnings).toEqual(["Frontmatter is not closed by ---"]);
});

test("newTest and blankStep", () => {
  expect(blankStep()).toEqual({ fields: {}, sources: [], images: [] });
  expect(blankStep(["Action", "Exigence"]).fields).toEqual({ Action: "", Exigence: "" });
  const t = newTest("DEMO", "/Release 8.0");
  expect(t).toMatchObject({
    project: "DEMO",
    folder: "/Release 8.0",
    labels: [],
    covers: [],
    extra: {},
    review: "draft",
  });
  expect(t.key).toBeUndefined();
  expect(t.steps).toHaveLength(1);
  expect(serializeTest(parseTest(serializeTest(t)).test)).toBe(serializeTest(t));
});

test("blocksOf splits a field into text, image and unreadable blocks", () => {
  const images = [{ file: "images/a.png", remoteId: "att-a" }, { file: "images/b.png" }];
  const text = 'one\n\n![](images/a.png "width=10,height=10")\n\ntwo\n\n![](images/b.png)';
  const bs = blocksOf(text, images);
  expect(bs.map((b) => b.kind)).toEqual(["text", "image", "text", "image"]);
  expect(bs.map((b) => text.slice(b.at, b.end))).toEqual([
    "one",
    '![](images/a.png "width=10,height=10")',
    "two",
    "![](images/b.png)",
  ]);
  expect(bs[1]).toMatchObject({ image: images[0], params: "width=10,height=10" });
  expect(bs[3]).toMatchObject({ params: "" });
});

test("a text block owns the whitespace the user types — only the break glued to another block is hidden", () => {
  const images = [{ file: "images/a.png" }];
  const shown = (t: string) => blocksOf(t, images).flatMap((b) => (b.kind === "text" ? [b.text] : []));
  expect(shown("abc \n\n![](images/a.png)")).toEqual(["abc "]);
  expect(shown("abc\n\n\n![](images/a.png)")).toEqual(["abc\n"]);
  expect(shown("![](images/a.png)\n\n abc")).toEqual([" abc"]);
  expect(shown("abc ")).toEqual(["abc "]);
  expect(shown("\nabc")).toEqual(["\nabc"]);
  expect(shown("abc\n\n![](images/a.png)\n\ndef")).toEqual(["abc", "def"]);
  const t = "abc \n\n![](images/a.png)\n\n def ";
  expect(blocksOf(t, images).map((b) => t.slice(b.at, b.end))).toEqual(["abc ", "![](images/a.png)", " def "]);
});

test("a ref to a file the step does not attach is plain text, a leftover Xray embed is not", () => {
  const images = [{ file: "images/a.png" }];
  expect(blocksOf("see ![](images/gone.png) here", images).map((b) => b.kind)).toEqual(["text"]);

  const raw = "one !xray-attachment://9a7|width=6,height=6! two";
  const bs = blocksOf(raw, images);
  expect(bs.map((b) => b.kind)).toEqual(["text", "raw", "text"]);
  expect(hasRawEmbed(step3(raw, "", "", { images }))).toBe(true);
  expect(hasRawEmbed(step3("clean", "", "![](images/a.png)", { images }))).toBe(false);
  expect(hasRawEmbed(step3("wow! really! yes!", "", "", { images }))).toBe(false);
  expect(hasRawEmbed({ fields: { Exigence: raw }, sources: [], images })).toBe(true);
});

test("an image Xray embeds by address is a readable extern block, not unreadable markup", () => {
  const images = [{ file: "images/a.png" }];
  const dead = '!blob:https://transurb.atlassian.net/788f365b-97a6|width=200,height=183,alt="shot.png"!';
  const text = `before\n\n${dead}\n\nafter !https://example.com/x.png! end`;
  const bs = blocksOf(text, images);
  expect(bs.map((b) => b.kind)).toEqual(["text", "extern", "text", "extern", "text"]);
  expect(bs[1]).toMatchObject({
    url: "blob:https://transurb.atlassian.net/788f365b-97a6",
    params: 'width=200,height=183,alt="shot.png"',
  });
  expect(bs[3]).toMatchObject({ url: "https://example.com/x.png", params: "" });
  expect(bs.map((b) => text.slice(b.at, b.end)).join("")).toBe(text.replace(/\n\n/g, ""));
  expect(hasRawEmbed(step3(text, "", "", { images }))).toBe(false);
  expect(blocksOf("ok! then: done! now", images).map((b) => b.kind)).toEqual(["text"]);
});

test("sameTestMd answers on identical bytes and normalises line endings and the Expected alias", () => {
  const md = serializeTest(mk(1));
  expect(sameTestMd(md, md)).toBe(true);
  const older = md.replace(/\n/g, "\r\n") + "\r\n";
  expect(older).not.toBe(md);
  expect(sameTestMd(md, older)).toBe(true);
  expect(sameTestMd(md, md.replace("### Expected Result", "### Expected"))).toBe(true);
  expect(sameTestMd(md, md.replace("summary:", "summary: edited"))).toBe(false);
});

test("mapRefs rewrites every ref and leaves the rest of the text alone", () => {
  const out = mapRefs('a ![](images/x.png "w=1") b ![](images/y.png) c', (file, params) =>
    imageRef(file.toUpperCase(), params),
  );
  expect(out).toBe('a ![](IMAGES/X.PNG "w=1") b ![](IMAGES/Y.PNG) c');
});

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project", "tests");
const fixture = (id: string, file = "test.md") => readFileSync(join(FIXTURE, id, file), "utf8");
const ORDER = ["Action", "Data", "Expected Result", "Exigence"];

test("the three fixture tests and their snapshots parse clean and round-trip byte for byte", () => {
  for (const [id, file] of [
    ["LFRPS12-1398", "test.md"],
    ["LFRPS12-1398", ".remote.md"],
    ["LFRPS12-1420", "test.md"],
    ["LFRPS12-1420", ".remote.md"],
    ["local-3f9a12c0", "test.md"],
  ]) {
    const md = fixture(id, file);
    const { test: t, warnings } = parseTest(md);
    expect(warnings, id + "/" + file).toEqual([]);
    expect(serializeTest(t), id + "/" + file).toBe(md);
    expect(serializeTest(t, ORDER), id + "/" + file).toBe(md);
  }
});

test("the fixture tests read as generic fields, sources and review state", () => {
  const { test: t } = parseTest(fixture("LFRPS12-1420"));
  expect(t.review).toBe("checked");
  expect(t.generatedBy).toBe("gen-tests-1a2b3c4d");
  expect(t.steps).toHaveLength(5);
  expect(Object.keys(t.steps[2].fields)).toEqual(["Action", "Data", "Expected Result", "Exigence"]);
  expect(t.steps[1].fields.Exigence).toBe("EXI_MOP_SPF_511_A_1670, EXI_MOP_SPF_510_A_20");
  expect(t.steps[0].sources).toEqual([
    {
      docId: "SOSIE_211_D401-1_3",
      anchor: "§5.6.6",
      quote: "Le sectionneur est représenté sur la schématique de traction par le symbole de la Figure 40",
    },
    { docId: "SOSIE_211_D401-1_3", anchor: "fig:40", quote: "Figure 40 – Représentation graphique sectionneur" },
  ]);
  expect(t.steps[0].images).toEqual([{ file: "images/fig-40.png", remoteId: "9001" }]);
  expect(t.steps[4].sources).toEqual([]);

  const { test: l } = parseTest(fixture("local-3f9a12c0"));
  expect(l).toMatchObject({
    key: undefined,
    review: "to-fix",
    reviewNote: "Le step 2 doit vérifier que seul Propriétés est proposé.",
    reviewedBy: "tester",
    reviewedAt: "2026-10-31T15:20:00.000Z",
  });
  expect(l.steps[1].sources[0]).toMatchObject({ anchor: "§5.6.6" });
});

test("fields are written in the order asked, then in file order; unknown ones are kept and reported", () => {
  const md =
    "---\nproject: P\nsummary: S\nfolder: /\n---\n\n## Step 1\n\n### Exigence\n\nE1\n\n### Commentaire\n\nc\n\n### Expected\n\nr\n\n### Action\n\na\n";
  const { test: t, warnings } = parseTest(md);
  expect(warnings).toEqual([]);
  expect(Object.keys(t.steps[0].fields)).toEqual(["Exigence", "Commentaire", "Expected Result", "Action"]);
  const out = serializeTest(t, ORDER);
  expect(out.indexOf("### Action")).toBeLessThan(out.indexOf("### Expected Result"));
  expect(out.indexOf("### Expected Result")).toBeLessThan(out.indexOf("### Exigence"));
  expect(out.indexOf("### Exigence")).toBeLessThan(out.indexOf("### Commentaire"));
  expect(serializeTest(t)).toContain(
    "### Exigence\n\nE1\n\n### Commentaire\n\nc\n\n### Expected Result\n\nr\n\n### Action",
  );
  expect(fieldWarnings(t, ORDER)).toEqual([
    'Step 1: "### Commentaire" is not a step field of this project (xray.json)',
  ]);
  expect(fieldName("expected results")).toBe("Expected Result");
  expect(fieldName("ACTION")).toBe("Action");
  expect(fieldName("Exigence")).toBe("Exigence");
});

test("step text before the first field is kept as its Action, empty fields are left out", () => {
  const { test: t, warnings } = parseTest(
    "---\nproject: P\n---\n\n## Step 1\n\nloose text\n\n### Data\n\n### Expected Result\n\nr\n",
  );
  expect(t.steps[0].fields).toEqual({ Action: "loose text", Data: "", "Expected Result": "r" });
  expect(warnings).toEqual(["Text before the first field of step 1 was kept as its Action"]);
  expect(serializeTest(t)).not.toContain("### Data");
});

test("Sources lines parse tolerantly: a malformed line is kept as written and reported", () => {
  const md = `---
project: P
---

## Step 1

### Action

a

### Sources

- DOC_1#§5.6.6 "Selon le type de sectionneur, le menu contextuel diffère"
- DOC_1#req:EXI_1 "a quote with "inner" quotes"
- DOC_2#fig:40
* DOC_3#§1 "star bullet"
DOC_4#§2 "no bullet"
- just some words
`;
  const { test: t, warnings } = parseTest(md);
  expect(t.steps[0].sources).toEqual([
    { docId: "DOC_1", anchor: "§5.6.6", quote: "Selon le type de sectionneur, le menu contextuel diffère" },
    { docId: "DOC_1", anchor: "req:EXI_1", quote: 'a quote with "inner" quotes' },
    { docId: "DOC_2", anchor: "fig:40", quote: "" },
    { docId: "DOC_3", anchor: "§1", quote: "star bullet" },
    { docId: "DOC_4", anchor: "§2", quote: "no bullet" },
    { docId: "just some words", anchor: "", quote: "" },
  ]);
  expect(warnings).toEqual([
    "Step 1: source DOC_2#fig:40 has no quote",
    'Source line without a "- " bullet in step 1: "DOC_4#§2 "no bullet""',
    'Step 1: source "just some words" is not docId#anchor "quote" — kept as written',
  ]);
  const out = serializeTest(t);
  expect(out).toContain('- DOC_2#fig:40\n- DOC_3#§1 "star bullet"\n- DOC_4#§2 "no bullet"\n- just some words\n');
  expect(parseTest(out).test.steps[0].sources).toEqual(t.steps[0].sources);
  expect(serializeTest(parseTest(out).test)).toBe(out);
});

test("parseSource and formatSource are inverse", () => {
  const s = parseSource('- SOSIE_211_D401-1_3#§5.6.6 "Selon le type"');
  expect(s).toEqual({ docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6", quote: "Selon le type" });
  expect(formatSource(s!)).toBe('SOSIE_211_D401-1_3#§5.6.6 "Selon le type"');
  expect(parseSource("no anchor here")).toBeNull();
  expect(parseSource('DOC#a "unclosed')).toBeNull();
});

test("review state: default draft, unknown value reported, the note survives quotes and newlines", () => {
  expect(parseTest("---\nproject: P\n---\n").test.review).toBe("draft");
  const bad = parseTest("---\nproject: P\nreview: done\n---\n");
  expect(bad.test.review).toBe("draft");
  expect(bad.warnings).toEqual(['Unknown review state "done" — kept as written, read as draft']);
  const note = 'Step 2: "Propriétés" #1\nsecond line';
  const md = serializeTest({ ...newTest("P", "/"), review: "to-fix", reviewNote: note });
  expect(md).toContain("review: to-fix\nreview_note: ");
  expect(parseTest(md).test.reviewNote).toBe(note);
});

test("a field written twice in a step is reported once per repeat, and nothing of either copy is lost", () => {
  const md = [
    "---\nproject: P\nfolder: /\n---\n",
    "## Step 1\n\n### Action\n\nalone\n",
    "## Step 2\n\n### Action\n\nfirst\n\n### Expected Result\n\nseen\n\n### action\n\nsecond\n",
    '### Sources\n\n- D#a "q"\n\n### Sources\n\n- D#b "r"\n',
  ].join("\n");
  const { test: t, warnings } = parseTest(md);
  expect(warnings).toEqual(['Duplicate "### action" in step 2', 'Duplicate "### Sources" in step 2']);
  expect(t.steps[0].fields.Action).toBe("alone");
  expect(t.steps[1].fields.Action).toContain("first");
  expect(t.steps[1].fields.Action).toContain("second");
  expect(t.steps[1].fields["Expected Result"]).toBe("seen");
  expect(t.steps[1].sources.map((s) => s.anchor)).toEqual(["a", "b"]);
});
