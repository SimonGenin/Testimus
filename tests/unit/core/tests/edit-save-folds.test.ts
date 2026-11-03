import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { quietCtx } from "../../../../src/core/command.ts";
import { commands } from "../../../../src/core/commands/tests.ts";
import { setModes } from "../../../../src/core/lib/columns.ts";
import { copyFixture, tempRoot } from "../../cov-faces-helpers.ts";

const LOCAL = "local-3f9a12c0";
let project = "";
const run = async (name: string, raw: unknown = {}): Promise<any> => {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return c.run(quietCtx(project), c.input.parse(raw) as never);
};

beforeEach(() => {
  project = copyFixture(tempRoot("tests"));
});

describe("tests.edit", () => {
  it("changes folder, description and covers", async () => {
    await run("tests.edit", { id: LOCAL, folder: "/Signalisation", description: "Nouvelle", covers: ["LFRPS12-1"] });
    const shown = await run("tests.show", { id: LOCAL });
    expect(shown.test).toMatchObject({ folder: "/Signalisation", description: "Nouvelle", covers: ["LFRPS12-1"] });
  });
});

describe("tests.save", () => {
  it("takes a test without extra keys and keeps the reserved ones on disk", async () => {
    const shown = await run("tests.show", { id: LOCAL });
    const { extra: _extra, ...test } = shown.test;
    await run("tests.save", { id: LOCAL, test: { ...test, summary: "Sans extra" } });
    const md = readFileSync(join(project, "tests", LOCAL, "test.md"), "utf8");
    expect(md).toContain("summary: Sans extra");
    expect(md).toContain("generated_by: gen-tests-1a2b3c4d");
    await run("tests.save", { id: LOCAL, test: { ...test, extra: { team_key: "kept", review: "validated" } } });
    const again = readFileSync(join(project, "tests", LOCAL, "test.md"), "utf8");
    expect(again).toContain("team_key: kept");
    expect(again).toContain("review: to-fix");
  });
});

describe("tests.folds", () => {
  it("lists the project's collapsed and filled fields", async () => {
    setModes(project, { Exigence: "collapsed" });
    const r = await run("tests.folds", { id: LOCAL });
    expect(r).toEqual({ own: null, project: { Data: "filled", Exigence: "collapsed" } });
  });

  it("keeps only the valid modes of a test's own columns and follows the project again on {}", async () => {
    await run("tests.setFolds", { id: LOCAL, modes: { Action: "collapsed" } });
    writeFileSync(
      join(project, "tests", LOCAL, "local.json"),
      JSON.stringify({ columns: { Action: "collapsed", Data: "weird", "Expected Result": "open" } }),
    );
    expect((await run("tests.folds", { id: LOCAL })).own).toEqual({ Action: "collapsed", "Expected Result": "open" });
    expect((await run("tests.setFolds", { id: LOCAL, modes: {} })).own).toBeNull();
    expect((await run("tests.setFolds", { id: LOCAL, modes: null })).own).toBeNull();
  });
});
