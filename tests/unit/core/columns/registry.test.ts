import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-columns.ts";
import { call, fixtureCopy } from "../registry.ts";

type Column = { name: string; origin: string; mode: string; description: string };

let P = "";
const real = env.spawnClaude;
beforeEach(() => {
  P = fixtureCopy("cols-reg");
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  env.spawnClaude = (s) => mockSpawnClaude({ ...s, signal: undefined });
});
afterEach(() => {
  env.spawnClaude = real;
});

const names = (cs: Column[]) => cs.map((c) => c.name);

describe("columns.* through the registry, each output against its schema", () => {
  it("columns.list gives the step columns in display order", async () => {
    const cs = await call<Column[]>("columns.list", {}, P);
    expect(names(cs).slice(0, 3)).toEqual(["Action", "Data", "Expected Result"]);
    await expect(call("columns.list", {}, null)).rejects.toThrow(/No project is open/);
  });

  it("columns.save describes a column or adds a local one; columns.remove takes a local one away", async () => {
    const saved = await call<Column[]>("columns.save", { name: "Poste", description: "Le poste de l'étape" }, P);
    expect(saved.find((c) => c.name === "Poste")).toMatchObject({
      origin: "local",
      description: "Le poste de l'étape",
    });
    expect(JSON.parse(readFileSync(join(P, "columns.json"), "utf8"))).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Poste" })]),
    );
    expect(names(await call<Column[]>("columns.remove", { name: "Poste" }, P))).not.toContain("Poste");
  });

  it("columns.setModes and columns.order write how and where the columns show", async () => {
    const moded = await call<Column[]>("columns.setModes", { modes: { Action: "collapsed" } }, P);
    expect(moded.find((c) => c.name === "Action")?.mode).toBe("collapsed");
    const ordered = await call<Column[]>("columns.order", { names: ["Expected Result", "Action"] }, P);
    expect(names(ordered).slice(0, 2)).toEqual(["Expected Result", "Action"]);
  });

  it("columns.suggest asks Claude and saves nothing", async () => {
    const before = await call<Column[]>("columns.list", {}, P);
    const r = await call<{ ok: boolean; proposals: unknown[] }>("columns.suggest", { ask: "" }, P, { wait: true });
    expect(r.ok).toBe(true);
    expect(await call("columns.list", {}, P)).toEqual(before);
  });
});
