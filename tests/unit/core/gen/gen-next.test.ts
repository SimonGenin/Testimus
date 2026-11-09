import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NEXT_MARKER, nextText, parseNext } from "../../../../src/core/claude/gen-next.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-gen.ts";
import "../../../../src/core/mock/claude-check.ts";
import { mockNext } from "../../../../src/core/mock/claude-next.ts";
import type { ClaudeAction } from "../../../../src/core/types.ts";
import { markIndexedInDb as markIndexed } from "../../helpers/index-state.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const REQUEST = "Menu contextuel des sectionneurs";
const real = env.spawnClaude;
let dir: string;
let asked: ClaudeSpawn[];

type Gen = { generation: string; tests: string[]; revised?: string[]; ok: boolean };
type Shown = { suggestions: { label: string; prompt: string; scope?: string }[] };
type Listed = ClaudeAction & { stale: boolean };
type Event = { type: string; level?: string; message?: string };

const generate = () =>
  invoke("gen.tests", { request: REQUEST, sections: ["SOSIE_211_D401-1_3#§5.6.6"] }, { project: dir }) as Promise<Gen>;
const actionsOf = (generation: string) => invoke("actions.list", { generation }, { project: dir }) as Promise<Listed[]>;
const shown = (generation: string) => invoke("gen.show", { generation }, { project: dir }) as Promise<Shown>;
const logs = async (job: string) =>
  ((await invoke("jobs.show", { id: job }, { project: dir })) as { events: Event[] }).events
    .filter((e) => e.type === "log")
    .map((e) => `${e.level}: ${e.message}`);
const ok = (text: string) => `{"type":"result","subtype":"success","is_error":false,"result":${JSON.stringify(text)}}`;

// ponytail: the step after the generation answers what `reply` gives (the scripted Claude's answer by default); the
// other runs are the scripted generation and check
function claude(reply: (s: ClaudeSpawn) => string | null = (s) => mockNext(s.stdin)) {
  env.spawnClaude = async (s) => {
    if (!s.stdin.startsWith(NEXT_MARKER)) return mockSpawnClaude(s);
    asked.push(s);
    const text = reply(s);
    if (text === null) return { code: 1, stdout: "", stderr: "Credit balance is too low" };
    s.onLine?.(ok(text));
    return { code: 0, stdout: `${ok(text)}\n`, stderr: "" };
  };
}

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-gen-next-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  markIndexed(dir);
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  asked = [];
  process.env.TESTIMUS_MOCK_CLAUDE_STEP_MS = "1";
});

afterEach(() => {
  env.spawnClaude = real;
  delete process.env.TESTIMUS_MOCK_CLAUDE_STEP_MS;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("after a generation Claude says what is next", () => {
  it("one cheap run reads the tests and their findings: its fixes go on the tests, its suggestions on the generation", async () => {
    claude();
    const g = await generate();
    expect(asked).toHaveLength(1);
    const run = asked[0];
    expect(run.args[run.args.indexOf("--model") + 1]).toBe("sonnet");
    expect(run.args[run.args.indexOf("--effort") + 1]).toBe("low");
    expect(run.stdin).toContain(`${NEXT_MARKER} ${g.generation}:`);
    expect(run.stdin).toContain(`The request: ${REQUEST}`);
    for (const id of g.tests) expect(run.stdin).toMatch(new RegExp(`^## ${id} — « .+ » \\(\\d+ steps?\\)$`, "m"));
    expect(run.stdin).toMatch(/^- warning(, step \d+)?, [\w-]+: /m);
    expect(run.stdin).toContain("Items no test was written for:");

    const listed = await actionsOf(g.generation);
    const onTests = listed.filter((a) => a.where.startsWith("test:"));
    expect(onTests.length).toBeGreaterThan(0);
    for (const a of onTests) {
      expect(g.tests).toContain(a.where.slice(5));
      expect(a.title).not.toMatch(/^Fix the \d+/);
      expect(a.proposedBy).toMatchObject({ run: "after generation", model: "sonnet", effort: "low" });
      expect(a.plan.length).toBeGreaterThan(0);
    }
    expect(onTests.map((a) => a.title)).toContain("Add the TK case: the menu shows only Propriétés");
    expect(onTests.find((a) => a.title.startsWith("Add the TK case"))?.suggest).toEqual({
      model: "sonnet",
      effort: "medium",
    });
    expect(
      listed
        .filter((a) => a.where === `gen:${g.generation}`)
        .map((a) => a.title)
        .sort(),
    ).toEqual([
      "Write the 1 test skipped for « Hors du périmètre demandé »",
      "Write the 2 tests skipped for « Pas de source pour le résultat attendu »",
    ]);

    const s = await shown(g.generation);
    expect(s.suggestions.map((x) => x.label)).toContain("Add the faulty TK cases");
    expect(s.suggestions.find((x) => x.label === "Add the faulty TK cases")?.scope).toBe("add");
    expect(s.suggestions.find((x) => x.label === "Check each command of the menu")?.scope).toBeUndefined();
    const said = await logs(g.generation);
    expect(said).toContainEqual(
      expect.stringMatching(/^info: Claude proposed \d+ fix(es)? and \d+ suggestions? \(sonnet, low effort: .+\)\.$/),
    );
  });

  it("the same fixes proposed again stay one action per problem", async () => {
    claude();
    const g = await generate();
    const before = (await actionsOf(g.generation)).map((a) => a.id).sort();
    const { proposeNext } = await import("../../../../src/core/claude/gen-next.ts");
    const { quietCtx } = await import("../../../../src/core/command.ts");
    await proposeNext(quietCtx(dir), dir, g.generation, {
      tests: g.tests,
      skipped: [],
      by: { runId: "r", model: "opus", effort: "high" },
      ask: true,
    });
    expect((await actionsOf(g.generation)).map((a) => a.id).sort()).toEqual(before);
  });

  it("when the step fails the core's own fixes are proposed, the cost is said, the old suggestions stay", async () => {
    claude(() => null);
    const g = await generate();
    expect(asked).toHaveLength(1);
    const onTests = (await actionsOf(g.generation)).filter((a) => a.where.startsWith("test:"));
    expect(onTests.length).toBeGreaterThan(0);
    for (const a of onTests) expect(a.title).toMatch(/^Fix the \d+ (error|warning)s? in « .+ »$/);
    expect(await logs(g.generation)).toContainEqual(
      expect.stringMatching(
        /^warn: Claude did not say what is next \(.+; sonnet, low effort: .+\): the fixes are the core's own\.$/,
      ),
    );
    expect((await shown(g.generation)).suggestions).toEqual([]);
  });

  it("a reply without its block, or with fixes on no test of the generation, leaves the core's fixes", async () => {
    claude(() => "Nothing to say.");
    const g = await generate();
    const titles = (await actionsOf(g.generation)).filter((a) => a.where.startsWith("test:")).map((a) => a.title);
    expect(titles.every((t) => /^Fix the \d+/.test(t))).toBe(true);

    asked = [];
    claude(
      () =>
        '```gen-next\n{"fixes":[{"test":"LFRPS12-1420","title":"Rewrite a test of no generation","problem":"p","why":"w","plan":["a"]}],"suggestions":[]}\n```',
    );
    const h = await generate();
    expect(asked).toHaveLength(1);
    expect(await logs(h.generation)).toContainEqual(
      "info: Claude proposed 0 fixes and 0 suggestions (sonnet, low effort: cost unknown).",
    );
    const own = (await actionsOf(h.generation)).filter((a) => a.where.startsWith("test:")).map((a) => a.title);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((t) => /^Fix the \d+/.test(t))).toBe(true);
    expect((await invoke("actions.list", { testId: "LFRPS12-1420" }, { project: dir })) as Listed[]).toEqual([]);
  });

  it("a test with findings Claude left without a fix gets the core's", async () => {
    claude((s) => {
      const first = /^## (local-[0-9a-f]{8}) /m.exec(s.stdin)?.[1] ?? "";
      return `\`\`\`gen-next\n${JSON.stringify({
        fixes: [{ test: first, title: "Quote §5.6.6 in step 2", problem: "p", why: "w", plan: ["read", "quote"] }],
        suggestions: [{ label: "Add the faulty TK cases", prompt: "Add them.", scope: "add" }],
      })}\n\`\`\``;
    });
    const g = await generate();
    const onTests = (await actionsOf(g.generation)).filter((a) => a.where.startsWith("test:"));
    const claudes = onTests.filter((a) => a.proposedBy.run === "after generation");
    expect(claudes.map((a) => a.title)).toEqual(["Quote §5.6.6 in step 2"]);
    const others = onTests.filter((a) => a.where !== claudes[0].where);
    for (const a of others) expect(a.title).toMatch(/^Fix the \d+/);
    expect(onTests.filter((a) => a.where === claudes[0].where)).toHaveLength(1);
  });

  it("gen.revise asks again on the tests it changed and keeps the generation's last suggestions when it cannot", async () => {
    claude();
    const g = await generate();
    const first = (await shown(g.generation)).suggestions;
    expect(first.length).toBeGreaterThan(0);
    asked = [];
    const r = (await invoke(
      "gen.revise",
      { generation: g.generation, request: "Précise les commandes", mode: "change", tests: [g.tests[0]] },
      { project: dir },
    )) as Gen;
    expect(r.revised).toEqual([g.tests[0]]);
    expect(asked).toHaveLength(1);
    expect(asked[0].stdin).toContain("read the tests it changed");
    expect(asked[0].stdin).toContain(`## ${g.tests[0]} — `);
    expect(asked[0].stdin).not.toContain(`## ${g.tests[1]} — `);
    const last = (await shown(g.generation)).suggestions;
    expect(last).not.toEqual(first);

    asked = [];
    claude(() => null);
    await invoke(
      "gen.revise",
      { generation: g.generation, request: "Ajoute la fermeture", mode: "add" },
      { project: dir },
    );
    expect(asked).toHaveLength(1);
    expect((await shown(g.generation)).suggestions).toEqual(last);
  });

  it("a generation that failed after writing tests does not ask Claude: the core proposes", async () => {
    claude();
    const spawn = env.spawnClaude;
    env.spawnClaude = async (s) => {
      const out = await spawn(s);
      return s.stdin.includes("Use the generate-tests skill")
        ? { ...out, code: 1, stderr: "Credit balance is too low" }
        : out;
    };
    const g = await generate();
    expect(g.ok).toBe(false);
    expect(g.tests.length).toBeGreaterThan(0);
    expect(asked).toHaveLength(0);
    const titles = (await actionsOf(g.generation)).filter((a) => a.where.startsWith("test:")).map((a) => a.title);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.every((t) => /^Fix the \d+/.test(t))).toBe(true);
  });
});

describe("the reply after a generation", () => {
  it("keeps what is a fix or a suggestion and drops the rest, never the whole reply", () => {
    const reply = [
      "```gen-next",
      "{ broken",
      "```",
      "```gen-next",
      JSON.stringify({
        fixes: [
          {
            test: "local-0000aaaa",
            title: "Add EXI_MOP_CDC_365_1640 to steps 6 and 10",
            problem: "p",
            plan: ["a", " ", 3],
            model: "opus",
            effort: "max",
          },
          { test: "local-0000aaaa", title: "no", problem: "p", plan: ["a"] },
          { test: "local-0000aaaa", title: "No plan", problem: "p", plan: [] },
          { title: "No test", problem: "p", plan: ["a"] },
          "junk",
        ],
        suggestions: [
          { label: "A", prompt: "a", scope: "add" },
          { label: "A", prompt: "again" },
          { label: "B", prompt: "b", scope: "elsewhere" },
          { label: "", prompt: "c" },
          { label: "C", prompt: "c" },
          { label: "D", prompt: "d" },
          { label: "E", prompt: "e" },
          { label: "F", prompt: "f" },
        ],
      }),
      "```",
    ].join("\n");
    const r = parseNext(reply);
    expect(r.found).toBe(true);
    expect(r.fixes).toEqual([
      {
        test: "local-0000aaaa",
        title: "Add EXI_MOP_CDC_365_1640 to steps 6 and 10",
        problem: "p",
        why: "The findings name the passages that settle them.",
        plan: ["a"],
        model: "opus",
        effort: undefined,
      },
    ]);
    expect(r.suggestions).toEqual([
      { label: "A", prompt: "a", scope: "add" },
      { label: "B", prompt: "b" },
      { label: "C", prompt: "c" },
      { label: "D", prompt: "d" },
      { label: "E", prompt: "e" },
    ]);
    expect(parseNext("```json\n{}\n```")).toEqual({ found: false, fixes: [], suggestions: [] });
    expect(parseNext("```gen-next\n{ broken\n```").found).toBe(false);
  });

  it("says the request (or that there was none), the language, and a test with no finding as it is", () => {
    const text = nextText({
      generation: "g",
      request: "",
      language: "fr",
      tests: [{ id: "local-0000aaaa", summary: "A", steps: 1, findings: [], text: "body of A" }],
      skipped: [],
    });
    expect(text).toContain("The request: (documents only, no words)");
    expect(text).toContain("Language of the tests: French.");
    expect(text).toContain("## local-0000aaaa — « A » (1 step)\nNo finding.\n```markdown\nbody of A\n```");
    expect(text).not.toContain("Items no test was written for:");
  });
});

describe("the scripted Claude after a generation", () => {
  it("answers the findings its prompt lists, at most three per test", () => {
    const prompt = [
      `${NEXT_MARKER} g: read`,
      "## local-0000aaaa — « Menu A » (3 steps)",
      "Findings:",
      "- warning, step 2, vague-result: m",
      "- warning, negative-missing: m",
      "- error, step 1, not-simulated-unsourced: m",
      "- warning, step 3, vague-result: m",
      "## local-0000bbbb — « Menu B » (2 steps)",
      "No finding.",
    ].join("\n");
    const r = parseNext(mockNext(prompt));
    expect(r.fixes.map((f) => [f.test, f.title])).toEqual([
      ["local-0000aaaa", "List the commands §5.6.6 gives in step 2"],
      ["local-0000aaaa", "Add the TK case: the menu shows only Propriétés"],
      ["local-0000aaaa", "Source or drop « not simulated » in step 1"],
    ]);
    expect(r.suggestions.map((s) => s.label)).toContain("Merge the 2 menu tests");
  });
});
