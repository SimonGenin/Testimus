import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { commands } from "../../../../src/core/commands/tests.ts";
import { isStale, runMechanical } from "../../../../src/core/lib/check.ts";
import { testHash } from "../../../../src/core/lib/hash.ts";
import { patchReview, setReview } from "../../../../src/core/lib/review.ts";
import { readTest } from "../../../../src/core/lib/store.ts";
import { insideTest } from "../../../../src/core/lib/test-blocks.ts";
import { parseTest, serializeTest, testMdHash } from "../../../../src/core/lib/testfile.ts";
import type { Test } from "../../../../src/core/types.ts";

const FIXTURE = resolve(import.meta.dirname, "..", "..", "..", "fixtures", "project");
let P = "";

beforeEach(() => {
  P = mkdtempSync(join(tmpdir(), "testimus-s3-"));
  cpSync(FIXTURE, P, { recursive: true });
});

const run = async <T>(name: string, input: unknown): Promise<T> => {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return (await c.run(quietCtx(P), c.input.parse(input) as never)) as T;
};
const file = (id: string) => join(P, "tests", id, "test.md");
const md = (id: string) => readFileSync(file(id), "utf8");
const roundTrip = (s: string) => serializeTest(parseTest(s).test);

const BODY = "## Description\n\nd\n\n## Step 1\n\n### Action\n\na\n";

describe("M3 — a fence with trailing whitespace or CRLF is the same fence everywhere", () => {
  const spaced = `--- \nkey: LFRPS12-7\nproject: LFRPS12\nsummary: S\nlabels: []\nreview: draft\n---\t\n\n${BODY}`;

  test("the parser reads the frontmatter behind `--- ` fences", () => {
    expect(parseTest(spaced).test).toMatchObject({ key: "LFRPS12-7", project: "LFRPS12", summary: "S" });
  });

  test("a review decision keeps key, summary and project, and the body bytes", () => {
    for (const src of [spaced, spaced.replace(/\n/g, "\r\n"), `﻿${spaced}`]) {
      const out = patchReview(src, { review: "validated", by: "me", at: "2026-11-02T10:00:00Z" });
      const t = parseTest(out).test;
      expect(t).toMatchObject({ key: "LFRPS12-7", project: "LFRPS12", summary: "S", review: "validated" });
      expect(t.reviewedBy).toBe("me");
      expect(out.endsWith(src.slice(src.lastIndexOf("## Description")))).toBe(true);
      expect(testMdHash(out)).toBe(testMdHash(src));
    }
  });

  test("only the closing fence spaced: same result", () => {
    const s = `---\nkey: K-1\nproject: K\nsummary: S\nreview: draft\n--- \n\n${BODY}`;
    expect(parseTest(patchReview(s, { review: "to-fix", note: "x" })).test).toMatchObject({
      key: "K-1",
      review: "to-fix",
      reviewNote: "x",
    });
  });

  test("a file without a closed frontmatter is refused, not rewritten", () => {
    expect(() => patchReview(BODY, { review: "validated" })).toThrow(/no readable frontmatter/);
    expect(() => patchReview("---\nproject: P\nsummary: S\n\n## Step 1\n", { review: "validated" })).toThrow(
      /no readable frontmatter/,
    );
  });

  test("setReview on a spaced-fence test on disk: key kept, check not stale", () => {
    const id = "LFRPS12-1398";
    writeFileSync(file(id), md(id).replace(/^---\n/, "--- \r\n"));
    runMechanical(P, id);
    setReview(P, id, { review: "to-fix", note: "n" });
    expect(readTest(P, id).test).toMatchObject({ key: "LFRPS12-1398", review: "to-fix" });
    expect(isStale(P, id)).toBe(false);
  });

  test("testMdHash equals testHash on a well-formed file", () => {
    const ok = md("LFRPS12-1420");
    expect(testMdHash(ok)).toBe(testHash(ok));
    expect(testMdHash(ok.replace(/\n/g, "\r\n"))).toBe(testHash(ok));
  });
});

describe("M11 — the editor cannot set the review keys", () => {
  test("tests.save keeps review, note, reviewer, date and generated_by from disk", async () => {
    const id = "local-3f9a12c0";
    writeFileSync(
      file(id),
      md(id)
        .replace(/^review: .*$/m, "review: draft")
        .replace(/^review_note: .*\n/m, ""),
    );
    const s = await run<{ test: Test }>("tests.show", { id });
    const forged: Test = {
      ...s.test,
      summary: "Edited summary",
      review: "validated",
      reviewedBy: "nobody",
      reviewedAt: "2020-01-01",
      reviewNote: "n",
      generatedBy: undefined,
      extra: { ...s.test.extra, "#raw:review": "review: validated" },
    };
    await run("tests.save", { id, test: forged });
    const t = parseTest(md(id)).test;
    expect(t).toMatchObject({
      summary: "Edited summary",
      review: "draft",
      generatedBy: "gen-tests-1a2b3c4d",
      reviewedBy: "tester",
      reviewedAt: "2026-10-31T15:20:00.000Z",
    });
    expect(t.reviewNote).toBeUndefined();
    expect(md(id)).not.toContain("validated");
  });

  test("a validated test edited by a human keeps validated (the state is not the editor's to change)", async () => {
    const id = "LFRPS12-1398";
    const s = await run<{ test: Test }>("tests.show", { id });
    const edited = structuredClone(s.test);
    edited.steps[0].fields.Action = "Autre action.";
    edited.review = "draft";
    await run("tests.save", { id, test: edited });
    expect(parseTest(md(id)).test).toMatchObject({ review: "validated", reviewedBy: s.test.reviewedBy });
    expect(parseTest(md(id)).test.steps[0].fields.Action).toBe("Autre action.");
  });
});

describe("minor 1 — unknown ## sections are kept in place", () => {
  const withSections = `---
project: P
summary: S
folder: /
labels: []
review: draft
---

## Description

d

## Notes

important team note
### a sub heading
- item

## Step 1

### Action

a

## Between

between steps

## Step 2

### Action

b

## Annex

the end
`;

  test("parse → serialize is byte-identical and the sections stay where they were", () => {
    expect(roundTrip(withSections)).toBe(withSections);
    const { warnings } = parseTest(withSections);
    expect(warnings).toEqual([
      'Kept unknown section "## Notes" as written',
      'Kept unknown section "## Between" as written',
      'Kept unknown section "## Annex" as written',
    ]);
  });

  test("tests.edit and tests.save keep them", async () => {
    const id = "local-3f9a12c0";
    writeFileSync(file(id), `${md(id)}\n## Notes\n\nkeep me\n`);
    await run("tests.edit", { id, summary: "x" });
    expect(md(id)).toContain("## Notes\n\nkeep me\n");
    const s = await run<{ test: Test }>("tests.show", { id });
    await run("tests.save", { id, test: { ...s.test, extra: {} } });
    expect(md(id)).toContain("## Notes\n\nkeep me\n");
  });

  test("a removed step moves a later section up, never drops it", () => {
    const t = parseTest(withSections).test;
    t.steps.pop();
    const out = serializeTest(t);
    expect(out).toContain("## Between\n\nbetween steps");
    expect(out.trimEnd().endsWith("## Annex\n\nthe end")).toBe(true);
  });
});

describe("minor 2 — a frontmatter value that does not parse is kept as written", () => {
  test("a YAML list of labels is read and written back as written", () => {
    const src = `---\nproject: P\nsummary: S\nfolder: /\nlabels:\n  - foo\n  - "bar"\nreview: draft\n---\n\n${BODY}`;
    const { test: t } = parseTest(src);
    expect(t.labels).toEqual(["foo", "bar"]);
    expect(roundTrip(src)).toBe(src);
    expect(serializeTest({ ...t, labels: ["foo"] })).toContain("labels: [foo]\n");
  });

  test("an unknown review state is kept as written, with a warning — not silently draft", () => {
    const src = `---\nproject: P\nsummary: S\nfolder: /\nlabels: []\nreview: approved\n---\n\n${BODY}`;
    const { test: t, warnings } = parseTest(src);
    expect(warnings).toEqual(['Unknown review state "approved" — kept as written, read as draft']);
    expect(t.review).toBe("draft");
    expect(roundTrip(src)).toBe(src);
    expect(parseTest(patchReview(src, { review: "draft" })).test.review).toBe("draft");
    expect(serializeTest({ ...t, review: "to-fix" })).toContain("review: to-fix\n");
  });

  test("comments, stray lines and unknown multi-line keys come back", () => {
    const src = `---\nproject: P\nsummary: S\nfolder: /\nlabels: []\nreview: draft\nowner: me\n# a comment\ntags:\n  - a\n  - b\n---\n\n${BODY}`;
    expect(roundTrip(src)).toBe(src);
  });

  test("a kept entry never smuggles a fence or a second key", () => {
    const t = parseTest(`---\nproject: P\n---\n`).test;
    const out = serializeTest({
      ...t,
      extra: { "#raw:review": "review: draft\nreview: validated", "#line:0": "---", "#raw:tags": "tags:\nreview: x" },
    });
    expect(parseTest(out).test.review).toBe("draft");
    expect(out.match(/^---$/gm)).toHaveLength(2);
    expect(out).not.toContain("validated");
  });

  test("### Result yields to a real step field named Result", () => {
    const src = `---\nproject: P\nsummary: S\nfolder: /\nlabels: []\nreview: draft\n---\n\n## Description\n\n## Step 1\n\n### Expected Result\n\nX\n\n### Result\n\nY\n`;
    expect(Object.keys(parseTest(src).test.steps[0].fields)).toEqual(["Expected Result"]);
    const real = parseTest(src, ["Action", "Expected Result", "Result"]);
    expect(real.test.steps[0].fields).toEqual({ "Expected Result": "X", Result: "Y" });
    expect(serializeTest(real.test)).toBe(src);
  });

  test("readTest and tests.edit use the project's fields", async () => {
    const id = "local-3f9a12c0";
    const x = JSON.parse(readFileSync(join(P, "xray.json"), "utf8"));
    x.fields.push({ id: "f-result", name: "Result", type: "text", builtin: false });
    writeFileSync(join(P, "xray.json"), JSON.stringify(x));
    await run("tests.edit", { id, steps: [{ op: "set", step: 1, field: "Result", value: "R" }] });
    expect(readTest(P, id).test.steps[0].fields.Result).toBe("R");
    expect(md(id)).toContain("### Result\n\nR");
  });
});

describe("attachments stay inside the test folder", () => {
  const bad = [
    "../../../home/.atlassian/credentials.json",
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    "c:/x.png",
    "file:///x",
  ];

  test("insideTest", () => {
    for (const f of bad) expect(insideTest(f), f).toBe(false);
    for (const f of ["images/x.png", "images/sub/y.png", "shot.png", "images/a..b.png"])
      expect(insideTest(f), f).toBe(true);
  });

  test("the parser warns about an attachment or an embedded ref outside the folder", () => {
    const src = `---\nproject: P\n---\n\n## Step 1\n\n### Action\n\n![](../x.png) and ![](https://example.com/a.png)\n\n### Attachments\n\n- ../../creds.json\n- images/ok.png\n`;
    expect(parseTest(src).warnings).toEqual([
      'Step 1: attachment "../../creds.json" is not a file inside the test folder (images/…)',
      'Step 1: image "../x.png" is not a file inside the test folder (images/…)',
    ]);
  });

  test("tests.save and tests.edit refuse to write one", async () => {
    const id = "local-3f9a12c0";
    const before = md(id);
    const s = await run<{ test: Test }>("tests.show", { id });
    for (const file of bad) {
      const t = structuredClone(s.test);
      t.steps[0].images.push({ file });
      await expect(run("tests.save", { id, test: t })).rejects.toThrow(/not a file inside the test folder/);
    }
    await expect(
      run("tests.edit", { id, steps: [{ op: "set", step: 1, field: "Action", value: "![](C:/secret.png)" }] }),
    ).rejects.toThrow(/not a file inside the test folder/);
    expect(md(id)).toBe(before);
  });
});
