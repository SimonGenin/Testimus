import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { invoke } from "../../src/core/commands/index.ts";
import { readTest } from "../../src/core/lib/store.ts";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "project");
const FIG = join(FIXTURE, "docs", "SOSIE_211_D401-1_3", "figures", "fig-40.png");
let dir: string;
let outside: string;

const add = (input: Record<string, unknown>) => invoke("tests.addImage", input, { project: dir });

beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), "testimus-images-"));
  dir = join(root, "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  outside = join(root, "shot.png");
  writeFileSync(outside, Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
});

afterEach(() => {
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("tests.addImage", () => {
  it("copies a document figure, lists it in the step's attachments and embeds it at the end of Expected Result", async () => {
    const r = (await add({ id: "local-3f9a12c0", step: 2, figure: "SOSIE_211_D401-1_3#fig:40" })) as {
      file: string;
      field: string;
    };
    expect(r.file).toMatch(/^images\/img-[0-9a-f]{8}\.png$/);
    expect(r.field).toBe("Expected Result");
    const copy = join(dir, "tests", "local-3f9a12c0", r.file);
    expect(readFileSync(copy)).toEqual(readFileSync(FIG));
    const { test, warnings } = readTest(dir, "local-3f9a12c0");
    expect(warnings).toEqual([]);
    expect(test.steps[1].images).toEqual([{ file: r.file }]);
    expect(test.steps[1].fields["Expected Result"]).toBe(`Le menu contextuel s'ouvre.\n\n![](${r.file})`);
    expect(test.steps[0].images).toEqual([]);
  });

  it("accepts fig 40 written without the fig: prefix", async () => {
    const r = (await add({ id: "local-3f9a12c0", step: 1, figure: "SOSIE_211_D401-1_3#40", field: "Action" })) as {
      file: string;
    };
    expect(readTest(dir, "local-3f9a12c0").test.steps[0].fields.Action).toContain(`![](${r.file})`);
  });

  it("copies a file inside the project, and an absolute file the user picked", async () => {
    const a = (await add({ id: "local-3f9a12c0", step: 1, file: "tests/LFRPS12-1420/images/fig-40.png" })) as {
      file: string;
    };
    const b = (await add({ id: "local-3f9a12c0", step: 1, file: outside })) as { file: string };
    expect(a.file).not.toBe(b.file);
    const step = readTest(dir, "local-3f9a12c0").test.steps[0];
    expect(step.images.map((i) => i.file)).toEqual([a.file, b.file]);
    expect(step.fields["Expected Result"]).toBe(
      `Le sectionneur est affiché avec le symbole du sectionneur.\n\n![](${a.file})\n\n![](${b.file})`,
    );
    expect(readFileSync(join(dir, "tests", "local-3f9a12c0", b.file))).toEqual(readFileSync(outside));
  });

  it("refuses a relative path that climbs out of the project, a non-picture, a custom field, a missing step", async () => {
    await expect(add({ id: "local-3f9a12c0", step: 1, file: "../shot.png" })).rejects.toThrow(/outside the project/);
    await expect(add({ id: "local-3f9a12c0", step: 1, file: "docs/SOSIE_211_D401-1_3/doc.md" })).rejects.toThrow(
      /not a picture/,
    );
    await expect(
      add({ id: "local-3f9a12c0", step: 1, figure: "SOSIE_211_D401-1_3#fig:40", field: "Exigence" }),
    ).rejects.toThrow(/cannot be embedded in Exigence/);
    await expect(add({ id: "local-3f9a12c0", step: 9, figure: "SOSIE_211_D401-1_3#fig:40" })).rejects.toThrow(
      /Step 9 does not exist/,
    );
    await expect(add({ id: "local-3f9a12c0", step: 1 })).rejects.toThrow(/either a file or a figure/);
    await expect(add({ id: "local-3f9a12c0", file: outside })).rejects.toThrow(/which step/);
    await expect(add({ id: "local-3f9a12c0", step: 1, figure: "SOSIE_211_D401-1_3#fig:99" })).rejects.toThrow(
      /no figure 99/,
    );
    expect(existsSync(join(dir, "tests", "local-3f9a12c0", "images"))).toBe(false);
  });

  it("stores a pasted picture (dataBase64) without touching test.md", async () => {
    const md = readFileSync(join(dir, "tests", "local-3f9a12c0", "test.md"), "utf8");
    const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 9]).toString("base64");
    const r = await add({ id: "local-3f9a12c0", name: "paste.png", ext: "png", dataBase64: data });
    expect(r).toEqual({ file: expect.stringMatching(/^images\/img-[0-9a-f]{8}\.png$/) });
    const file = (r as { file: string }).file;
    expect(readFileSync(join(dir, "tests", "local-3f9a12c0", file))).toEqual(Buffer.from(data, "base64"));
    expect(readFileSync(join(dir, "tests", "local-3f9a12c0", "test.md"), "utf8")).toBe(md);
    const jpg = (await add({ id: "local-3f9a12c0", name: "photo.JPEG", dataBase64: data })) as { file: string };
    expect(jpg.file).toMatch(/\.jpg$/);
    await expect(add({ id: "local-3f9a12c0", ext: "exe", dataBase64: data })).rejects.toThrow(/not a picture/);
    await expect(add({ id: "local-nope0000", ext: "png", dataBase64: data })).rejects.toThrow(/No test/);
  });
});
