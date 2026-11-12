import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePlan } from "../../../../src/core/claude/gen-plan.ts";
import { genLabel, genPrompt, PLAN_MARKER } from "../../../../src/core/claude/gen-prompt.ts";
import {
  dedupeSkipped,
  parseGenReport,
  REPORT_TAG,
  type Skipped,
  STOPPED,
  skipDoubts,
} from "../../../../src/core/claude/gen-reply.ts";
import { refusedLine } from "../../../../src/core/claude/generate.ts";
import { find, invoke } from "../../../../src/core/commands/index.ts";
import { env } from "../../../../src/core/env.ts";
import { subscribe } from "../../../../src/core/jobs.ts";
import { loadCorpus } from "../../../../src/core/lib/check.ts";
import { DEFAULT_SETTINGS, readJson, writeSettings } from "../../../../src/core/lib/project.ts";
import { testExists } from "../../../../src/core/lib/store.ts";
import {
  checked,
  dir,
  fake,
  isCheck,
  planBlock,
  reportBlock,
  result,
  seen,
  testFile,
  tool,
  toolResult,
} from "../claude/run-fakes.ts";

const S = "SOSIE_211_D401-1_3#§5.6.6";
const idOf = (n: number) => `local-${String(n).padStart(8, "0")}`;
const nthOf = (stdin: string) => Number(stdin.match(/This is test (\d+) of/)?.[1] ?? 0);
const isPlanAsk = (stdin: string) => stdin.includes(PLAN_MARKER);
const planOf = (n: number) => ({
  tests: Array.from({ length: n }, (_, k) => ({ summary: `Bouton ${k + 1}`, sections: [S] })),
});
const md = (summary: string) =>
  `---\nsummary: ${summary}\nfolder: /\nlabels: []\nreview: draft\n---\n\n## Description\n\nD\n\n## Step 1\n\n### Action\n\nA\n\n### Expected Result\n\nB\n`;
const write = (cwd: string, id: string) => {
  mkdirSync(join(cwd, "tests", id), { recursive: true });
  writeFileSync(join(cwd, "tests", id, "test.md"), md(id));
};
const oneAtATime = () =>
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" }, agents: { max: 1, adaptive: false } });

type Result = {
  ok: boolean;
  tests: string[];
  checks: { id: string }[];
  skipped: Skipped[];
  remaining: number;
  generation: string;
  reportFound: boolean;
};

// ponytail: a plan of n tests; run k writes its test unless `nothing` says otherwise, and reports `report(k)`
function planned(n: number, o: { nothing?: (k: number) => boolean; report?: (k: number) => unknown[] } = {}) {
  fake((s) => {
    if (isCheck(s)) return checked();
    if (isPlanAsk(s.stdin)) return { lines: () => [result(`Plan.\n${planBlock(planOf(n))}`)] };
    const k = nthOf(s.stdin);
    const wrote = !o.nothing?.(k);
    return {
      during: (sp) => {
        if (wrote) write(sp.cwd, idOf(k));
      },
      lines: (sp) => [
        ...(wrote ? [tool("Write", { file_path: join(sp.cwd, "tests", idOf(k), "test.md") })] : []),
        result(reportBlock({ tests: wrote ? [idOf(k)] : [], skipped: o.report?.(k) ?? [] })),
      ],
    };
  });
}

describe("what follows the writing is done even when a run fails (G7)", () => {
  it("a run that throws is a failed run: the job ends, the others are checked, the rest is left to resume", async () => {
    oneAtATime();
    planned(3);
    const inner = env.spawnClaude;
    env.spawnClaude = (s) => {
      if (nthOf(s.stdin) === 2) throw new Error("boom");
      return inner(s);
    };
    const r = (await invoke("gen.tests", { request: "Boutons" }, { project: dir })) as Result;
    expect(r.ok).toBe(false);
    expect(r.tests).toEqual([idOf(1)]);
    expect(seen.some(isCheck)).toBe(true);
    expect(r.checks.map((c) => c.id)).toEqual([idOf(1)]);
    expect(r.skipped.filter((s) => s.reason === "stopped")).toEqual(
      ["Bouton 2", "Bouton 3"].map((item) => ({
        item,
        reason: "stopped",
        category: STOPPED,
        why: "not written: the generation stopped on a failed run — resume it",
      })),
    );
    expect(r.remaining).toBe(2);
  });

  it("an id that is not a folder name is a test that does not exist, and the doubt says so", () => {
    expect(testExists(dir, "autre test du plan")).toBe(false);
    expect(testExists(dir, "../LFRPS12")).toBe(false);
    const s: Skipped = {
      item: "Menu",
      reason: "already-tested",
      category: "Already tested",
      why: "Another test of the plan verifies it.",
      test: "autre test du plan",
    };
    expect(skipDoubts(dir, s, loadCorpus(dir), { consulted: [], searched: [] })).toEqual([
      'It names "autre test du plan", which is not a test of this project.',
    ]);
  });

  it("an already-tested item that names a description is refused and asked again, naming the field", async () => {
    const logs: string[] = [];
    const off = subscribe((e) => {
      if (e.type === "log") logs.push(e.message);
    });
    const item = { item: "Menu B", reason: "already-tested", why: "Another test of the plan verifies the menu B." };
    fake((s) =>
      s.args.includes("--resume")
        ? { lines: () => [result(reportBlock({ tests: [], skipped: [{ ...item, test: "LFRPS12-1398" }] }))] }
        : { lines: () => [result(reportBlock({ tests: [], skipped: [{ ...item, test: "autre test du plan" }] }))] },
    );
    const r = (await invoke("gen.tests", { request: "x", check: false }, { project: dir })) as Result;
    off();
    expect(seen).toHaveLength(2);
    expect(seen[1].stdin).toContain('skipped.0.test: "autre test du plan" is not a test id');
    expect(logs.some((m) => m.startsWith("The gen-report block of generate was refused (skipped.0.test: "))).toBe(true);
    expect(r.reportFound).toBe(true);
    expect(r.skipped.map((s) => [s.item, s.test])).toEqual([["Menu B", "LFRPS12-1398"]]);
  });
});

describe("a planned test counts as written only when its run wrote it", () => {
  it("an ok run without a test leaves its planned test to the resume", async () => {
    oneAtATime();
    planned(2, { nothing: (k) => k === 2 });
    const r = (await invoke("gen.tests", { request: "Boutons", check: false }, { project: dir })) as Result;
    expect(r.ok).toBe(true);
    expect(r.tests).toEqual([idOf(1)]);
    expect(r.remaining).toBe(1);
    expect(r.skipped).toEqual([
      {
        item: "Bouton 2",
        reason: "stopped",
        category: STOPPED,
        why: "not written: the run ended without writing its test — resume it",
      },
    ]);
    const ledger = readJson<{ done: number[] }>(join(dir, ".testimus", "gen", `${r.generation}.json`), { done: [] });
    expect(ledger.done).toEqual([0]);
  });
});

describe("the runs of a plan know each other (G6)", () => {
  it("a later run is told the other tests, with the id of one already written; an item they take is dropped", async () => {
    oneAtATime();
    const why = "Another test of this plan verifies this behavior.";
    planned(3, {
      report: (k) =>
        k === 2
          ? [
              { item: "Bouton 3 allumé", reason: "already-tested", why, test: "plan:3" },
              { item: "Bouton 1 allumé", reason: "already-tested", why, test: idOf(1) },
            ]
          : [],
    });
    const r = (await invoke("gen.tests", { request: "Boutons", check: false }, { project: dir })) as Result;
    const second = seen.find((s) => nthOf(s.stdin) === 2)?.stdin ?? "";
    expect(second).toContain(`- plan:1 Bouton 1 — ${S} (${idOf(1)})\n- plan:3 Bouton 3 — ${S}\n`);
    expect(seen.find((s) => nthOf(s.stdin) === 1)?.stdin).toContain(`- plan:2 Bouton 2 — ${S}\n- plan:3 Bouton 3`);
    expect(r.tests).toHaveLength(3);
    expect(r.skipped).toEqual([]);
  });

  it("the planned prompt lists the others only when there are some", () => {
    const part = { n: 2, of: 3, request: "Boutons" };
    expect(genPrompt(dir, { request: "Bouton 2", sections: [S] }, [], part)).not.toContain("plan:");
    const p = genPrompt(dir, { request: "Bouton 2", sections: [S] }, [], {
      ...part,
      others: [{ n: 1, summary: "Bouton 1", sections: [], ids: [] }],
    });
    expect(p).toContain("give its test id, else plan:<its number>:\n- plan:1 Bouton 1\n");
  });

  it("a report may name a test of the same plan as plan:<n>, never a description; dedupe drops it", () => {
    const item = { item: "Menu B", reason: "already-tested", why: "Another test of the plan verifies it." };
    const r = parseGenReport(
      `\`\`\`${REPORT_TAG}\n${JSON.stringify({ skipped: [{ ...item, test: "plan:3" }] })}\n\`\`\``,
    );
    expect(r.found).toBe(true);
    expect(dedupeSkipped(r.skipped)).toEqual([]);
    for (const test of ["local-0a1b2c3d", "LFRPS12-1420"])
      expect(
        parseGenReport(`\`\`\`${REPORT_TAG}\n${JSON.stringify({ skipped: [{ ...item, test }] })}\n\`\`\``).found,
      ).toBe(true);
    expect(
      parseGenReport(
        `\`\`\`${REPORT_TAG}\n${JSON.stringify({ skipped: [{ ...item, test: "le test du menu" }] })}\n\`\`\``,
      ).errors[0],
    ).toMatch(/^skipped\.0\.test: "le test du menu" is not a test id/);
  });
});

describe("a reply's optional fields may be null (G5)", () => {
  const SRC = `${S} "Selon le type de sectionneur, le menu contextuel diffère"`;

  it("null is absent in a report and in a plan", () => {
    const report = {
      tests: null,
      covered: null,
      skipped: [
        {
          item: "Menu C",
          reason: "out-of-scope",
          why: "The request is about the menu of the sectionneur.",
          sources: [SRC],
          searched: null,
          read: null,
          unblock: null,
          test: null,
        },
      ],
    };
    const r = parseGenReport(`\`\`\`${REPORT_TAG}\n${JSON.stringify(report)}\n\`\`\``);
    expect(r).toMatchObject({ found: true, tests: [], covered: [] });
    expect(r.skipped[0]).toEqual({
      item: "Menu C",
      reason: "out-of-scope",
      category: "Outside the request",
      why: report.skipped[0].why,
      sources: [SRC],
    });
    const plan = parsePlan(
      `\`\`\`test-plan\n${JSON.stringify({ tests: [{ summary: "Test A", technique: null, sections: null, theme: null }], skipped: null, questions: null })}\n\`\`\``,
    );
    expect(plan).toEqual({
      found: true,
      tests: [{ summary: "Test A", technique: "", sections: [] }],
      skipped: [],
      questions: [],
    });
  });

  it("a refused block is said with the fields refused, an absent one as absent", () => {
    const item = {
      item: "Menu D",
      reason: "documents-disagree",
      why: "§5.6.6 and §5.6.7 say otherwise.",
      sources: [SRC],
    };
    const r = parseGenReport(`\`\`\`${REPORT_TAG}\n${JSON.stringify({ skipped: [item] })}\n\`\`\``);
    expect(r.errors).toEqual(["skipped.0.sources: documents-disagree: cite the two passages, each in sources"]);
    expect(refusedLine("generate 49/111", REPORT_TAG, r.errors)).toBe(
      "The gen-report block of generate 49/111 was refused (skipped.0.sources: documents-disagree: cite the two passages, each in sources): Claude is asked again.",
    );
    expect(refusedLine("generate", REPORT_TAG, parseGenReport("nothing").errors)).toBe(
      "The reply of generate has no gen-report block: Claude is asked for it again.",
    );
  });
});

describe("a test left as tests.create made it is removed (G4)", () => {
  it("a cancelled run leaves no empty folder behind", async () => {
    const ctrl = new AbortController();
    let made = "";
    fake(() => ({
      during: async (s) => {
        made = ((await invoke("tests.create", { summary: "Squelette" }, { project: s.cwd })) as { id: string }).id;
        ctrl.abort();
      },
      lines: () => [
        tool("mcp__testimus__tests_create", { summary: "Squelette" }, "c1"),
        toolResult("c1", JSON.stringify({ id: made })),
        result("Cancelled"),
      ],
    }));
    await invoke("gen.tests", { request: "x", check: false }, { project: dir, signal: ctrl.signal }).catch(() => null);
    expect(made).toMatch(/^local-[0-9a-f]{8}$/);
    expect(existsSync(testFile(made))).toBe(false);
  });

  it("a run that ends with an empty draft writes no test, and the draft goes", async () => {
    let made = "";
    fake(() => ({
      during: async (s) => {
        made = ((await invoke("tests.create", {}, { project: s.cwd })) as { id: string }).id;
      },
      lines: () => [
        tool("mcp__testimus__tests_create", {}, "c1"),
        toolResult("c1", JSON.stringify({ id: made })),
        result(reportBlock({ tests: [made], skipped: [] })),
      ],
    }));
    const r = (await invoke("gen.tests", { request: "x", check: false }, { project: dir })) as Result;
    expect(r.tests).toEqual([]);
    expect(existsSync(testFile(made))).toBe(false);
  });
});

describe("a generation's job is named after it", () => {
  const label = (raw: unknown) => {
    const c = find("gen.tests");
    return c.label?.(c.input.parse(raw) as never, dir);
  };

  it("the words of the request without its preamble, else its documents; a resume, the tests left", () => {
    expect(label({ request: "Génère les tests pour le menu des sectionneurs" })).toBe(
      "Generate: Le menu des sectionneurs",
    );
    expect(label({ request: "Write tests for the breaker menu" })).toBe("Generate: The breaker menu");
    expect(label({ request: "Menu du disjoncteur" })).toBe("Generate: Menu du disjoncteur");
    expect(label({ docs: ["SOSIE_211_D401-1_3"] })).toBe("Generate: SOSIE_211_D401-1_3");
    expect(genLabel({ request: "x".repeat(90) })).toHaveLength(90);
    mkdirSync(join(dir, ".testimus", "gen"), { recursive: true });
    writeFileSync(
      join(dir, ".testimus", "gen", "generate-0001.json"),
      JSON.stringify({ consulted: [], searched: [], input: { request: "x" }, plan: planOf(5), done: [0, 1] }),
    );
    expect(label({ resume: "generate-0001" })).toBe("Generate 3 tests");
    expect(genLabel({ request: "" }, 1)).toBe("Generate 1 test");
  });
});
