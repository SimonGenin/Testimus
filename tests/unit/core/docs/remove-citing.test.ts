import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listed, proposeAction } from "../../../../src/core/lib/actions.ts";
import { testsCiting } from "../../../../src/core/lib/check.ts";
import { readDoc, removeDoc, writeDoc } from "../../../../src/core/lib/docs.ts";

const FIXTURE = resolve(import.meta.dirname, "../../../fixtures/project");
const D3 = "SOSIE_211_D401-1_3";
const D4 = "SOSIE_211_D401-1_4";
let P = "";

beforeEach(() => {
  P = mkdtempSync(join(tmpdir(), "testimus-remove-"));
  cpSync(FIXTURE, P, { recursive: true });
});
afterEach(() => rmSync(P, { recursive: true, force: true }));

describe("removing a document that others amend", () => {
  it("each other document forgets it, keeping what else it amends", () => {
    const d4 = readDoc(P, D4);
    writeDoc(P, { ...d4, amends: [D3, "OTHER_DOC"] });
    expect(removeDoc(P, D3)).toEqual([D4]);
    expect(existsSync(join(P, "docs", D3))).toBe(false);
    expect(readDoc(P, D4).amends).toEqual(["OTHER_DOC"]);
  });

  it("a document that amended only it no longer amends anything", () => {
    const d4 = readDoc(P, D4);
    writeDoc(P, { ...d4, amends: [D3] });
    removeDoc(P, D3);
    expect(readDoc(P, D4).amends).toBeUndefined();
  });
});

describe("the tests that cite a document", () => {
  it("are the tests whose steps cite it by id, counting those steps; a folder without test.md is not a test", () => {
    mkdirSync(join(P, "tests", "LFRPS12-9999"), { recursive: true });
    writeFileSync(join(P, "tests", "LFRPS12-9999", "notes.txt"), "no test here");
    const citing = testsCiting(P, { id: D3 });
    expect(citing.map((t) => t.id)).toEqual(["LFRPS12-1398", "LFRPS12-1420", "local-3f9a12c0"]);
    expect(citing.every((t) => t.steps > 0)).toBe(true);
    expect(testsCiting(P, { id: "NOBODY_CITES_ME" })).toEqual([]);
  });

  it("is none in a project without a tests folder", () => {
    rmSync(join(P, "tests"), { recursive: true, force: true });
    expect(testsCiting(P, { id: D3 })).toEqual([]);
  });
});

describe("an action proposed for a place that is not one", () => {
  it("is refused with the places it can name", () => {
    expect(() =>
      proposeAction(P, {
        title: "t",
        scope: { kind: "project" },
        problem: "p",
        why: "w",
        plan: [],
        proposedBy: { run: "job", model: "", effort: "", at: "" },
        where: "somewhere:else",
      }),
    ).toThrow("Not a problem place: somewhere:else.");
  });
});

describe("an action left running when the app stopped", () => {
  it("is open again once no job runs it", () => {
    const a = proposeAction(P, {
      title: "Recover the figures",
      scope: { kind: "project" },
      problem: "figures missing",
      why: "w",
      plan: [],
      proposedBy: { run: "job", model: "", effort: "", at: "" },
    });
    expect(listed(P, { ...a, state: "running" }).state).toBe("open");
    expect(listed(P, { ...a, state: "done" }).state).toBe("done");
  });
});
