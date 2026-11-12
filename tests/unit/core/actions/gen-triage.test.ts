import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { startJob } from "../../../../src/core/jobs.ts";
import { allActions } from "../../../../src/core/lib/actions.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { call, fixtureCopy } from "../registry.ts";

const real = env.spawnClaude;
let P = "";
let seen: ClaudeSpawn[] = [];
const S = "SOSIE_211_D401-1_3#§5.6.6";

beforeEach(() => {
  P = fixtureCopy("gen-triage");
  seen = [];
  resetProbe();
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "claude" } });
  env.spawnClaude = async (s) => {
    seen.push(s);
    if (s.args.includes("--version")) return { code: 0, stdout: "2.1.0 (Claude Code)\n", stderr: "" };
    const l = JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "0 proposed.",
      session_id: "s",
    });
    s.onLine?.(l);
    return { code: 0, stdout: `${l}\n`, stderr: "" };
  };
});
afterEach(() => {
  env.spawnClaude = real;
  resetProbe();
});

async function failedGeneration(ledger: Record<string, unknown>): Promise<string> {
  const { job, done } = startJob("generate", "Boutons", P, async () => {
    throw new Error("a run broke");
  });
  await done.catch(() => {});
  mkdirSync(join(P, ".testimus", "gen"), { recursive: true });
  writeFileSync(
    join(P, ".testimus", "gen", `${job.id}.json`),
    JSON.stringify({ consulted: [], searched: [], input: { request: "Boutons", folder: "/Traction" }, ...ledger }),
  );
  return job.id;
}

type Triaged = { ok: boolean; proposed: { title: string; where: string; scope: unknown; plan: string[] }[] };

describe("a failed generation's triage gets its ledger, and the core proposes the obvious (G8)", () => {
  it("a planned test not written and no check: two actions without a model, the run told the facts", async () => {
    const plan = {
      found: true,
      tests: [
        { summary: "Bouton 1", technique: "", sections: [S] },
        { summary: "Bouton 2", technique: "états", sections: [S] },
      ],
      skipped: [],
    };
    const id = await failedGeneration({ plan, done: [0], tests: ["local-3f9a12c0"] });
    const r = await call<Triaged>("actions.triage", { jobId: id }, P);
    expect(r.proposed.map((a) => a.title)).toEqual([
      "Write the missed test: Bouton 2",
      "Check the 1 test of the generation",
    ]);
    expect(r.proposed.every((a) => a.where === `gen:${id}`)).toBe(true);
    expect(r.proposed[0].plan[1]).toContain("tests_create, its whole content in the call, in /Traction");
    expect(r.proposed[1].scope).toEqual({ kind: "tests", testIds: ["local-3f9a12c0"] });
    const run = seen.find((s) => !s.args.includes("--version"));
    expect(run?.stdin).toContain(`- [gen:${id}] Planned test not written: Bouton 2`);
    expect(run?.stdin).toContain(`- [gen:${id}] The check step did not run on the 1 test(s) written.`);
    expect(run?.stdin).toContain("Testimus already proposed « Write the missed test: Bouton 2 »");
    expect(allActions(P).filter((a) => a.where === `gen:${id}`)).toHaveLength(2);
  });

  it("a generation that wrote and checked everything gets no action of the core", async () => {
    const plan = { found: true, tests: [{ summary: "Bouton 1", technique: "", sections: [S] }], skipped: [] };
    const id = await failedGeneration({
      plan,
      done: [0],
      tests: ["local-3f9a12c0"],
      checks: [{ id: "local-3f9a12c0", ok: true, review: "draft", errors: 0, warnings: 0 }],
    });
    const r = await call<Triaged>("actions.triage", { jobId: id }, P);
    expect(r.proposed).toEqual([]);
    expect(seen.find((s) => !s.args.includes("--version"))?.stdin).not.toContain("Planned test not written");
  });
});
