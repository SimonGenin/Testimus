import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPrompt } from "../../../../src/core/claude/check.ts";
import { GEN_MARKER } from "../../../../src/core/claude/gen-prompt.ts";
import { REPORT_TAG } from "../../../../src/core/claude/gen-reply.ts";
import { reviewPart } from "../../../../src/core/claude/gen-review.ts";
import type { ClaudeSpawn } from "../../../../src/core/env.ts";
import { writeJson } from "../../../../src/core/lib/project.ts";
import { readCheck, readTest } from "../../../../src/core/lib/store.ts";
import { mockSpawnClaude, mockStream } from "../../../../src/core/mock/claude.ts";
import { mockFindings, mockFix } from "../../../../src/core/mock/claude-check.ts";
import "../../../../src/core/mock/claude-gen.ts";
import { mockMachine, mockMachineKind } from "../../../../src/core/mock/machine.ts";
import type { Test } from "../../../../src/core/types.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");

function copy(): string {
  const dir = join(mkdtempSync(join(tmpdir(), "testimus-covmock-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

const spawn = (o: Partial<ClaudeSpawn>): ClaudeSpawn => ({ exe: "claude", args: [], cwd: tmpdir(), stdin: "", ...o });
const resultOf = (stdout: string) =>
  JSON.parse(stdout.trim().split("\n").pop() as string) as {
    result: string;
    is_error: boolean;
    total_cost_usd: number;
  };

const test = (steps: Test["steps"], summary = "S"): Test =>
  ({
    project: "LFRPS12",
    summary,
    folder: "/",
    labels: [],
    description: "",
    covers: [],
    preconditions: [],
    review: "draft",
    steps,
  }) as unknown as Test;

afterEach(() => {
  delete process.env.TESTIMUS_MOCK_MACHINE;
});

describe("mockStream", () => {
  it("returns cancelled at once when the signal is already aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const out = await mockStream(spawn({ signal: ac.signal }), { texts: ["x"], result: "x" });
    expect(out.code).toBe(130);
    expect(out.stdout.trim().split("\n")).toHaveLength(1);
  });

  it("stops during the tools and during the texts when cancelled", async () => {
    const during = async (stopAt: string) => {
      const ac = new AbortController();
      return await mockStream(
        spawn({
          signal: ac.signal,
          onLine: (l) => {
            if (l.includes(stopAt)) ac.abort();
          },
        }),
        { tools: [{ name: "Read", input: {} }], texts: ["hello"], result: "r", delayMs: 1 },
      );
    };
    const a = await during('"tool_use"');
    expect(a.code).toBe(130);
    expect(a.stdout).not.toContain("hello");
    const b = await during('"hello"');
    expect(b.code).toBe(130);
    expect(b.stdout).not.toContain('"result"');
  });

  it("an error stream exits 1 and resumes the session it is given", async () => {
    const out = await mockStream(spawn({ args: ["--resume", "sess-7"] }), {
      texts: [],
      result: "bad",
      isError: true,
      delayMs: 0,
    });
    expect(out.code).toBe(1);
    expect(out.stdout).toContain('"session_id":"sess-7"');
    expect(resultOf(out.stdout)).toMatchObject({ is_error: true, total_cost_usd: 0.0123 });
  });
});

describe("scripted runs", () => {
  it("a scoped run with nothing to edit says so", async () => {
    const dir = copy();
    const none = await mockSpawnClaude(spawn({ cwd: dir, stdin: "Scope: nothing.\n" }));
    expect(resultOf(none.stdout).result).toBe("Nothing to change.");
    const missing = await mockSpawnClaude(spawn({ cwd: dir, stdin: "Scope: x\nFiles: tests/LFRPS12-9/test.md\n" }));
    expect(resultOf(missing.stdout).result).toBe("Nothing to change.");
    const noStep = await mockSpawnClaude(
      spawn({ cwd: dir, stdin: "Scope: step 42 of test LFRPS12-1420.\nFiles: tests/LFRPS12-1420/test.md\n" }),
    );
    expect(resultOf(noStep.stdout).result).toBe("Nothing to change.");
  }, 10000);

  it("check and fix scripts on a test that does not exist record and change nothing", async () => {
    const dir = copy();
    const asked = checkPrompt([{ id: "LFRPS12-77", name: "Gone", steps: 2, mechanical: [] }], "fr", []);
    const check = await mockSpawnClaude(spawn({ cwd: dir, stdin: asked }));
    expect(resultOf(check.stdout).result).toBe("");
    expect(existsSync(join(dir, "tests", "LFRPS12-77"))).toBe(false);
    const fix = await mockSpawnClaude(spawn({ cwd: dir, stdin: "Use the fix-test skill on the test LFRPS12-77." }));
    expect(resultOf(fix.stdout).result).toMatch(/^Rien à modifier/);
  }, 10000);

  it("a check request is answered test by test: each one recorded with a verdict per step, a line each, then the review it asks for", async () => {
    const dir = copy();
    const tests = ["LFRPS12-1420", "LFRPS12-1398"].map((id) => ({
      id,
      name: readTest(dir, id).test.summary,
      steps: readTest(dir, id).test.steps.length,
      mechanical: [],
    }));
    const review = reviewPart({
      request: "Le sectionneur",
      tests: tests.map((t) => t.id),
      skipped: [
        {
          item: "Défaut de la TK pendant la manœuvre",
          reason: "no-source",
          category: "No source for the expected result",
          why: "Aucun passage ne dit ce que l'écran montre.",
        },
        { item: "Autre", reason: "not-observable", category: "Nothing a tester can observe", why: "Interne." },
      ],
    });
    const out = await mockSpawnClaude(spawn({ cwd: dir, stdin: checkPrompt(tests, "fr", [], [review.part.ask]) }));
    const result = resultOf(out.stdout).result;
    expect(result.split("\n").slice(0, 2)).toEqual([
      "LFRPS12-1420 : 1 erreur(s), 1 avertissement(s), 0 info(s).",
      "LFRPS12-1398 : 0 erreur(s), 0 avertissement(s), 1 info(s).",
    ]);
    expect(out.stdout.match(/mcp__testimus__check_record/g)).toHaveLength(2);
    await vi.waitFor(() => expect(readCheck(dir, "LFRPS12-1398")?.verdicts).toHaveLength(1));
    expect(readCheck(dir, "LFRPS12-1420")?.verdicts?.map((v) => v.verdict)).toEqual([
      "supported",
      "supported",
      "supported",
      "supported",
      "unsupported",
    ]);
    expect(review.part.answered(result)).toBe(true);
    expect([...(review.reply()?.verdicts ?? [])].map(([n, v]) => [n, v.verdict])).toEqual([
      [1, "writable"],
      [2, "confirmed"],
    ]);
    expect(review.reply()?.suggestions.map((s) => s.label)).toEqual([
      "Add the faulty TK cases",
      "Check each command of the menu",
      "Merge the 2 menu tests",
    ]);
  }, 10000);

  const genRequest = (request: string) =>
    `${GEN_MARKER}\nRequest: ${request}\nXray folder of the tests: none given — /\n\nWhat the team knows about the documents of this run:\n- D: les sectionneurs avec TK ne sont pas encore câblés.\n${REPORT_TAG}\n`;

  it("a generation without a folder lands in the default folder; a request about « avec TK » reads part of doc.md", async () => {
    const dir = copy();
    const before = readdirSync(join(dir, "tests"));
    const out = await mockSpawnClaude(spawn({ cwd: dir, stdin: genRequest("sectionneur avec TK") }));
    expect(out.code).toBe(0);
    expect(out.stdout).toContain('"offset":13,"limit":14');
    const made = readdirSync(join(dir, "tests")).filter((d) => !before.includes(d));
    expect(made).toHaveLength(2);
    for (const id of made) expect(readTest(dir, id).test.folder).toBe("/Traction/Sectionneurs");
  }, 10000);

  it("the request decides the partial read, never what goes with the run: a team's note that says « avec TK » changes nothing", async () => {
    const whole = await mockSpawnClaude(spawn({ cwd: copy(), stdin: genRequest("Menu contextuel des sectionneurs") }));
    expect(whole.stdout).not.toContain('"offset":13');
    expect(resultOf(whole.stdout).result).toContain(`\`\`\`${REPORT_TAG}\n{"tests":[`);
  });

  it("headers and figures scripts answer keyed blocks", async () => {
    const figures = await mockSpawnClaude(
      spawn({ stdin: "Testimus describe-figures run for X.\n- fig:1 — docs/X/figures/a.png\n" }),
    );
    expect(resultOf(figures.stdout).result).toContain('"fig:1"');
  });
});

describe("mockFindings", () => {
  it("falls back to the document section when no step cites an anchor, and skips a step without a result", () => {
    const f = mockFindings(
      test([
        { fields: { Action: "a" }, sources: [], images: [] },
        {
          fields: { Action: "b", "Expected Result": "Le résultat attendu est clairement décrit ici pour le testeur." },
          sources: [{ docId: "D", anchor: "", quote: "q" }],
          images: [],
        },
      ]),
    );
    expect(f).toEqual([expect.objectContaining({ kind: "case-missing", sources: ["SOSIE_211_D401-1_3#§5.6.6"] })]);
  });

  it("cites the first anchored source when it has one", () => {
    const f = mockFindings(
      test([
        {
          fields: { "Expected Result": "Le résultat attendu est clairement décrit ici pour le testeur." },
          sources: [{ docId: "D", anchor: "§1", quote: "q" }],
          images: [],
        },
      ]),
    );
    expect(f[0].sources).toEqual(["D#§1"]);
  });
});

describe("mockFix", () => {
  it("without a check and without a note changes nothing", () => {
    const dir = copy();
    const file = join(dir, "tests", "LFRPS12-1398", "test.md");
    const md = readFileSync(file, "utf8");
    expect(mockFix(dir, "LFRPS12-1398")).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(md);
  });

  it("skips the findings it has no fix for, and a vague result without a step", () => {
    const dir = copy();
    writeJson(join(dir, "tests", "LFRPS12-1398", "check.json"), {
      testHash: "x",
      at: "2026-01-01T00:00:00.000Z",
      findings: [
        { step: 1, kind: "wrong-object", severity: "error", message: "autre objet", sources: [], pass: "semantic" },
        { kind: "vague-result", severity: "warning", message: "vague", sources: [], pass: "semantic" },
      ],
    });
    expect(mockFix(dir, "LFRPS12-1398")).toEqual([]);
    expect(existsSync(join(dir, "tests", "LFRPS12-1398", "test.md"))).toBe(true);
  });
});

describe("mock machine", () => {
  it("counts the VRAM held by loaded models and defaults an unset kind", () => {
    const m = mockMachine("gpu16", [{ vramMB: 500 } as never, { vramMB: 300 } as never]);
    expect(m.gpus[0].vramUsedMB).toBe(2000);
    expect(mockMachineKind()).toBe("gpu16");
    expect(mockMachineKind("dev")).toBe("dev");
    expect(mockMachine("cpu-only", [{ vramMB: 1 } as never]).loaded).toEqual([]);
  });
});
