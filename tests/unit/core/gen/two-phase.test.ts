import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { planLines } from "../../../../src/core/claude/chat.ts";
import {
  overlaps,
  parsePlan,
  planText,
  settleAnswers,
  themeFolder,
  withoutTheme,
  writeCost,
} from "../../../../src/core/claude/gen-plan.ts";
import { genPrompt, REVIEW_MARKER } from "../../../../src/core/claude/gen-prompt.ts";
import { stampTest } from "../../../../src/core/claude/generate.ts";
import { LEARN_MARKER } from "../../../../src/core/claude/learn.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { listJobs, waitJob } from "../../../../src/core/jobs.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { readTest, writeTest } from "../../../../src/core/lib/store.ts";
import { newTest } from "../../../../src/core/lib/testfile.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-plan.ts";
import type { Proposal, Test } from "../../../../src/core/types.ts";
import { markIndexedInDb as markIndexed } from "../../helpers/index-state.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const DOC = "SOSIE_211_D401-1_3";
const real = env.spawnClaude;
const pace = process.env.TESTIMUS_MOCK_CLAUDE_STEP_MS;
let dir: string;
let seen: ClaudeSpawn[];

const block = (o: unknown) => `\`\`\`test-plan\n${JSON.stringify(o)}\n\`\`\``;
const call = <T>(name: string, input: unknown) => invoke(name, input, { project: dir }) as Promise<T>;

type Shown = {
  state?: string;
  plan?: {
    tests: { summary: string; technique: string; theme?: string; off?: boolean; sections: string[] }[];
    questions: { id: string }[];
  };
  settled: { text: string; answer: string }[];
  overlaps: { tests: [number, number]; sections: string[] }[];
  cost?: { runs: number; seconds: number; agents: number };
  mtime: number;
};
type Gen = { state?: string; tests: string[]; generation: string; remaining: number; ok: boolean };

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-plan-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  markIndexed(dir);
  seen = [];
  process.env.TESTIMUS_MOCK_CLAUDE_STEP_MS = "1";
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  env.spawnClaude = async (s) => {
    seen.push(s);
    return await mockSpawnClaude(s);
  };
});

afterEach(() => {
  env.spawnClaude = real;
  if (pace === undefined) delete process.env.TESTIMUS_MOCK_CLAUDE_STEP_MS;
  else process.env.TESTIMUS_MOCK_CLAUDE_STEP_MS = pace;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("the plan block", () => {
  it("reads a theme per test (out of the summary) and the questions, each with its passages and answers", () => {
    const p = parsePlan(
      block({
        tests: [
          { summary: "Traction — Coupure de la caténaire", theme: "Traction", sections: [`${DOC}#§5`] },
          { summary: "Itinéraire tracé", theme: " Itinéraires / Tracés ", technique: "états" },
          { summary: "Sans thème" },
        ],
        questions: [
          {
            id: "q1",
            text: "Quelle période par défaut ?",
            why: "§4.2 et §6.1 se contredisent.",
            sources: ['D#§4.2 "x"'],
          },
          {
            id: "q1",
            text: "Le menu change-t-il en défaut ?",
            why: "Le §5.6.6 ne le dit pas.",
            sources: ['D#§5 "y"'],
            answers: ["Oui", "Non", "Seulement Propriétés", "Autre", "Encore"],
          },
        ],
      }),
    );
    expect(p.found).toBe(true);
    expect(p.tests).toEqual([
      { summary: "Coupure de la caténaire", technique: "", sections: [`${DOC}#§5`], theme: "Traction" },
      { summary: "Itinéraire tracé", technique: "états", sections: [], theme: "Itinéraires - Tracés" },
      { summary: "Sans thème", technique: "", sections: [] },
    ]);
    expect(p.questions.map((q) => q.id)).toEqual(["q1", "q1-2"]);
    expect(p.questions[0].answers).toEqual([]);
    expect(p.questions[1].answers).toHaveLength(4);
  });

  it("refuses a question without its passage or its reason", () => {
    const p = parsePlan(block({ tests: [{ summary: "Test A" }], questions: [{ id: "q1", text: "Une question ?" }] }));
    expect(p.found).toBe(false);
    expect(p.errors).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^questions\.0\.why/),
        expect.stringMatching(/^questions\.0\.sources/),
      ]),
    );
  });

  it("keeps a summary that only starts like its theme", () => {
    expect(withoutTheme("Tractions multiples", "Traction")).toBe("Tractions multiples");
    expect(withoutTheme("traction: freinage", "Traction")).toBe("freinage");
  });
});

describe("what the core says of a plan, without a model", () => {
  it("flags the tests that read the same sections, or one inside the other, never an unticked one", () => {
    const t = (sections: string[], off?: boolean) => ({
      summary: "x",
      technique: "",
      sections,
      ...(off ? { off } : {}),
    });
    expect(
      overlaps([
        t([`${DOC}#§5.6`]),
        t([`${DOC}#§5.6.6`, `${DOC}#§7`]),
        t([`${DOC}#§5.7`]),
        t([`${DOC}#§7`], true),
        t(["OTHER#§5.6"]),
      ]),
    ).toEqual([{ tests: [0, 1], sections: [`${DOC}#§5.6`] }]);
  });

  it("costs one run per test, ~3 min 20 each, as many at a time as the agents", () => {
    expect(writeCost(7, 3)).toEqual({ runs: 7, seconds: 3 * 200 });
    expect(writeCost(1, 0)).toEqual({ runs: 1, seconds: 200 });
  });

  it("files a theme under the folder asked, or at the root", () => {
    expect(themeFolder("/Traction/", "Coupures")).toBe("/Traction/Coupures");
    expect(themeFolder("Traction", "Coupures")).toBe("/Traction/Coupures");
    expect(themeFolder(undefined, "A/B")).toBe("/A - B");
  });

  it("moves the questions answered to what is settled, the last answer winning", () => {
    const q = (id: string, text: string) => ({ id, text, why: "", sources: [], answers: [] });
    const r = settleAnswers([q("q1", "Un ?"), q("q2", "Deux ?")], [{ id: "q9", text: "un ?", answer: "avant" }], {
      q1: " Oui ",
      q2: "  ",
    });
    expect(r.questions.map((x) => x.id)).toEqual(["q2"]);
    expect(r.settled).toEqual([{ id: "q1", text: "Un ?", answer: "Oui" }]);
  });
});

describe("stampTest with a theme", () => {
  it("puts a planned test with a theme in <folder>/<theme> whatever its run wrote; without one, the old rule", () => {
    const id = "local-0000abcd";
    const t = (folder: string): Test => ({ ...newTest("LFRPS12", folder), summary: "Un test", description: "d" });
    writeTest(dir, id, t("/Ailleurs"));
    stampTest(dir, id, "gen-1", "/Traction", "Coupures");
    expect(readTest(dir, id).test.folder).toBe("/Traction/Coupures");
    stampTest(dir, id, "gen-1", undefined, "Coupures");
    expect(readTest(dir, id).test.folder).toBe("/Coupures");
    stampTest(dir, id, "gen-1", "/Traction");
    expect(readTest(dir, id).test.folder).toBe("/Coupures");
  });
});

describe("a generation in two times, through the registry", () => {
  const ask = { request: "Le menu contextuel du sectionneur", sections: [`${DOC}#§5.6.6`], folder: "/Traction" };

  it("stops at the plan, revises it with an answer, and writes it — each run told the answer, in theme sub-folders", async () => {
    const before = readdirTests();
    const planned = await call<Gen>("gen.tests", { ...ask, review: true, check: false });
    expect(planned.state).toBe("planned");
    expect(planned.tests).toEqual([]);
    expect(planned.remaining).toBe(3);
    expect(readdirTests()).toEqual(before);
    expect(seen).toHaveLength(1);
    expect(seen[0].stdin).toContain(REVIEW_MARKER);

    const g = planned.generation;
    let shown = await call<Shown>("gen.show", { generation: g });
    expect(shown.state).toBe("planned");
    expect(shown.plan?.tests.map((t) => t.theme)).toEqual([
      "Sectionneurs sans TK",
      "Sectionneurs sans TK",
      "Sectionneurs avec TK",
    ]);
    expect(shown.plan?.questions.map((q) => q.id)).toEqual(["q1"]);
    expect(shown.overlaps).toEqual([{ tests: [0, 2], sections: [`${DOC}#§5.6.6`] }]);
    expect(shown.cost?.runs).toBe(3);

    const answer = "Non, seulement Propriétés";
    const revised = await call<Gen>("gen.plan", { generation: g, answers: { q1: answer } });
    expect(revised.state).toBe("planned");
    expect(seen).toHaveLength(2);
    expect(seen[1].args).toContain("--resume");
    expect(seen[1].stdin).toContain(`→ ${answer}`);
    shown = await call<Shown>("gen.show", { generation: g });
    expect(shown.plan?.questions).toEqual([]);
    expect(shown.settled.map((s) => s.answer)).toEqual([answer]);
    expect(shown.plan?.tests[2].summary).toContain(answer);

    const written = await call<Gen>("gen.write", { generation: g });
    expect(written.ok).toBe(true);
    expect(written.state).toBeUndefined();
    expect(written.tests).toHaveLength(3);
    const learning = listJobs(dir).filter((j) => j.kind === "learn");
    expect(learning).toHaveLength(1);
    await waitJob(learning[0].id);
    const taught = seen.filter((r) => r.stdin.includes(LEARN_MARKER));
    expect(taught).toHaveLength(1);
    expect(taught[0].stdin).toContain("Claude: Before writing the tests of « Le menu contextuel du sectionneur »");
    expect(taught[0].stdin).toContain(`User: The team answers:`);
    expect(taught[0].stdin).toContain(`→ ${answer}`);
    const runs = seen.slice(2).filter((r) => !r.stdin.includes(LEARN_MARKER));
    expect(runs).toHaveLength(3);
    for (const r of runs) {
      expect(r.stdin).toContain("Questions the user settled on the plan");
      expect(r.stdin).toContain(`→ ${answer}`);
    }
    const folders = written.tests.map((id) => readTest(dir, id).test.folder).sort();
    expect(folders).toEqual([
      "/Traction/Sectionneurs avec TK",
      "/Traction/Sectionneurs sans TK",
      "/Traction/Sectionneurs sans TK",
    ]);
    for (const id of written.tests) expect(readTest(dir, id).test.description).toContain(answer);
    const ledger = JSON.parse(readFileSync(join(dir, ".testimus", "gen", `${g}.json`), "utf8"));
    expect(ledger.state).toBeUndefined();
    expect(ledger.settled).toEqual([expect.objectContaining({ answer })]);
    await expect(call("gen.plan", { generation: g })).rejects.toMatchObject({ code: "not-planned" });
  });

  it("an unticked test is not written, and the page's edits are refused once the ledger moved", async () => {
    const { generation: g } = await call<Gen>("gen.tests", { ...ask, review: true, check: false });
    const shown = await call<Shown>("gen.show", { generation: g });
    const tests = shown.plan?.tests ?? [];
    const set = await call<{ tests: { off?: boolean; summary: string }[] }>("gen.planSet", {
      generation: g,
      plan: { tests: [{ ...tests[0], summary: "Renommé" }, { ...tests[1], off: true }, tests[2]] },
      ifMtime: shown.mtime,
    });
    expect(set.tests.map((t) => [t.summary, !!t.off])).toEqual([
      ["Renommé", false],
      [tests[1].summary, true],
      [tests[2].summary, false],
    ]);
    await expect(
      call("gen.planSet", { generation: g, plan: { tests }, ifMtime: shown.mtime - 1000 }),
    ).rejects.toMatchObject({ code: "conflict" });
    const again = await call<Shown>("gen.show", { generation: g });
    expect(again.cost?.runs).toBe(2);
    const written = await call<Gen>("gen.write", { generation: g });
    expect(written.tests).toHaveLength(2);
    expect(written.tests.map((id) => readTest(dir, id).test.summary)).toContain("Renommé");
  });

  it("the chat is given the plan and proposes a new one, applied through gen.planSet and reverted by its run", async () => {
    const { generation: g } = await call<Gen>("gen.tests", { ...ask, review: true, check: false });
    const lines = planLines(dir, g, "run-1").join("\n");
    expect(lines).toContain("## Sectionneurs sans TK");
    expect(lines).toContain('gen_planPropose { runId: "run-1"');
    expect(planLines(dir, "nope", "run-1")).toEqual([]);
    const shown = await call<Shown>("gen.show", { generation: g });
    const tests = shown.plan?.tests ?? [];
    const p = await call<Proposal>("gen.planPropose", {
      runId: "run-20261112-ab",
      generation: g,
      plan: { tests: tests.map((t) => ({ ...t, theme: "Sectionneurs" })) },
      why: "Un seul thème suffit.",
    });
    expect(p.kind).toBe("plan");
    expect(p.before).toContain("## Sectionneurs sans TK");
    expect(p.after).toContain("## Sectionneurs\n");
    expect(p.after).toContain("## Questions");
    await call("chat.apply", { id: p.id });
    const after = await call<Shown>("gen.show", { generation: g });
    expect(new Set(after.plan?.tests.map((t) => t.theme))).toEqual(new Set(["Sectionneurs"]));
    expect(after.plan?.questions.map((q) => q.id)).toEqual(["q1"]);
    expect(planText({ tests: after.plan?.tests ?? [], questions: [] })).not.toContain("Questions");
  });

  it("an unplanned request with review is planned all the same, a request without review keeps today's path", () => {
    const p = genPrompt(dir, { ...ask, review: true });
    expect(p).toContain(`${REVIEW_MARKER}: use the plan-tests skill now`);
    expect(genPrompt(dir, ask)).not.toContain(REVIEW_MARKER);
  });
});

function readdirTests(): string[] {
  return readdirSync(join(dir, "tests")).sort();
}
