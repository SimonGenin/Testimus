import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { genBoard } from "../../../../src/core/claude/gen-board.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { env } from "../../../../src/core/env.ts";
import { subscribe } from "../../../../src/core/jobs.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-gen.ts";
import type { GenTestProgress, JobEvent } from "../../../../src/core/types.ts";
import { markIndexedInDb as markIndexed } from "../../helpers/index-state.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const real = env.spawnClaude;

describe("the generation board: which test Claude is writing", () => {
  it("one run: each test it starts is writing, the one before it written; the end leaves them all written", () => {
    const said: GenTestProgress[][] = [];
    const board = genBoard((t) => said.push(t));
    const run = board.run();
    expect(run.wrote("local-0000000a")).toBe(true);
    expect(run.wrote("local-0000000a")).toBe(false);
    expect(board.tests()).toEqual([{ id: "local-0000000a", state: "writing" }]);
    expect(run.wrote("local-0000000b")).toBe(true);
    expect(board.tests()).toEqual([
      { id: "local-0000000a", state: "written" },
      { id: "local-0000000b", state: "writing" },
    ]);
    expect(run.wrote("local-0000000a")).toBe(true);
    expect(board.tests().map((t) => t.state)).toEqual(["writing", "written"]);
    run.end();
    expect(said.at(-1)?.map((t) => t.state)).toEqual(["written", "written"]);
  });

  it("a plan: its tests wait with their summary, a run writes its own, one that wrote nothing is missed", () => {
    const said: GenTestProgress[][] = [];
    const board = genBoard((t) => said.push(t));
    const [a, b, c] = board.plan(["Menu", "Propriétés", "Ouverture"]);
    expect(said.at(-1)?.map((t) => t.state)).toEqual(["waiting", "waiting", "waiting"]);
    const one = board.start(a);
    const two = board.start(b);
    one.wrote("local-0000000a");
    expect(board.tests()).toEqual([
      { summary: "Menu", id: "local-0000000a", state: "writing" },
      { summary: "Propriétés", state: "writing" },
      { summary: "Ouverture", state: "waiting" },
    ]);
    one.end();
    two.end();
    expect(board.tests().map((t) => t.state)).toEqual(["written", "missed", "waiting"]);
    board.start(c).wrote("local-0000000c");
    expect(board.tests()[2]).toEqual({ summary: "Ouverture", id: "local-0000000c", state: "writing" });
    expect(board.plan([])).toEqual([]);
  });
});

describe("gen.tests says in its progress which test it writes", () => {
  let dir: string;
  beforeEach(() => {
    dir = join(mkdtempSync(join(tmpdir(), "testimus-board-")), "LFRPS12");
    cpSync(FIXTURE, dir, { recursive: true });
    markIndexed(dir);
    writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
    env.spawnClaude = mockSpawnClaude;
  });
  afterEach(() => {
    env.spawnClaude = real;
    rmSync(join(dir, ".."), { recursive: true, force: true });
  });

  it("against the --mock Claude: the first test is written, then the second, and the test on disk grows meanwhile", async () => {
    const boards: GenTestProgress[][] = [];
    const onDisk: boolean[] = [];
    let lines = 0;
    const off = subscribe((e: JobEvent) => {
      if (e.type === "progress") lines++;
      if (e.type !== "progress" || !e.gen) return;
      boards.push(e.gen);
      const writing = e.gen.find((t) => t.state === "writing");
      if (writing?.id) onDisk.push(existsSync(join(dir, "tests", writing.id, "test.md")));
    });
    const r = (await invoke(
      "gen.tests",
      { request: "Menu contextuel des sectionneurs", sections: ["SOSIE_211_D401-1_3#§5.6.6"], check: false },
      { project: dir },
    )) as { tests: string[] };
    off();
    const [a, b] = boards.at(-1)?.map((t) => t.id) ?? [];
    expect([a, b].sort()).toEqual([...r.tests].sort());
    const states = boards.map((g) => g.map((t) => `${t.id === a ? "a" : "b"}:${t.state}`).join(" "));
    expect(states).toContain("a:writing");
    expect(states).toContain("a:written b:writing");
    expect(states.at(-1)).toBe("a:written b:written");
    expect(onDisk.length).toBeGreaterThan(0);
    expect(onDisk.every(Boolean)).toBe(true);
    const said = boards.map((g) => JSON.stringify(g));
    for (let k = 1; k < said.length; k++)
      expect(said[k], "a progress line carries the board only when it moved").not.toBe(said[k - 1]);
    expect(lines).toBeGreaterThan(boards.length);
  });
});
