import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { genPrompt, STEPS_LINE } from "../../../../src/core/claude/gen-prompt.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { mechanicalCheck } from "../../../../src/core/lib/check.ts";
import { templateDir } from "../../../../src/core/lib/shipped.ts";
import { readTest } from "../../../../src/core/lib/store.ts";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/project/", import.meta.url));
const CLAUDE_SRC = fileURLToPath(new URL("../../../../src/core/claude/", import.meta.url));
const MOCK_SRC = fileURLToPath(new URL("../../../../src/core/mock/", import.meta.url));

const HARD_LIMITS = [
  /\b(at most|no more than|not more than|maximum of|max\.?|up to|limit(ed)? (of|to))\s+\d+\s+steps?\b/i,
  /\b\d+\s+steps?\s+(at most|maximum|max\b)(?![^.]*\b(aim|prefer|better|preference|request decides))/i,
  /\b(past|over|beyond|more than|longer than)\s+\d+\s+steps?\b[^.]{0,60}\b(is|are|must be|gets?|will be)\s+(split|refused|rejected|skipped|dropped)/i,
  /\b(refuse|reject|skip|drop)\w*\b[^.]{0,60}\b(too many steps|too long|longer than \d+|more than \d+ steps|over \d+ steps|past \d+ steps)/i,
  /\b(too many steps|too long)\b[^.]{0,40}\b(refuse|reject|skip|split)/i,
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}

const hardLimit = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .split(/(?<=[.;!?])\s/)
    .filter((sentence) => HARD_LIMITS.some((re) => re.test(sentence)));

let project = "";
beforeEach(() => {
  project = join(mkdtempSync(join(tmpdir(), "testimus-steps-")), "LFRPS12");
  cpSync(FIXTURE, project, { recursive: true });
});

describe("no hard limit on the number of steps", () => {
  it("the patterns catch a hard limit and let a preference through", () => {
    expect(hardLimit("A chapter is not a scenario: a test that grows past 15 steps is split.")).toHaveLength(1);
    expect(hardLimit("Write at most 15 steps per test.")).toHaveLength(1);
    expect(hardLimit("Refuse a test that has more than 15 steps.")).toHaveLength(1);
    expect(hardLimit("Skip a scenario that is too long.")).toHaveLength(1);
    expect(hardLimit(STEPS_LINE)).toEqual([]);
  });

  it("no shipped skill, no project template file says one", () => {
    const shipped = files(templateDir()).filter((f) => f.endsWith(".md"));
    expect(shipped.some((f) => f.endsWith(join("generate-tests", "SKILL.md")))).toBe(true);
    for (const f of shipped) expect({ f, hits: hardLimit(readFileSync(f, "utf8")) }).toEqual({ f, hits: [] });
  });

  it("no prompt the code builds says one, nor the mock Claude", () => {
    const sources = [...files(CLAUDE_SRC), ...files(MOCK_SRC)].filter((f) => f.endsWith(".ts"));
    for (const f of sources) expect({ f, hits: hardLimit(readFileSync(f, "utf8")) }).toEqual({ f, hits: [] });
    const whole = genPrompt(project, { request: "Tester le sectionneur", docs: ["SOSIE_211_D401-1_3"] });
    const part = genPrompt(project, { request: "Sectionneur" }, [], undefined, { n: 1, of: 2, request: "r" });
    for (const p of [whole, part]) {
      expect(p).toContain(STEPS_LINE);
      expect(hardLimit(p)).toEqual([]);
    }
  });

  it("generate-tests and plan-tests let the request decide the length", () => {
    const skill = (name: string) => readFileSync(join(templateDir(), ".claude", "skills", name, "SKILL.md"), "utf8");
    expect(skill("generate-tests").replace(/\s+/g, " ")).toMatch(/the request decides/);
    expect(skill("generate-tests").replace(/\s+/g, " ")).toMatch(/never refused, and a behavior never skipped/);
    expect(skill("plan-tests").replace(/\s+/g, " ")).toMatch(/The request decides the length/);
    expect(skill("check-test").replace(/\s+/g, " ")).toMatch(/the length of a test: .* never a finding/);
  });
});

describe("a long test passes the check", () => {
  const STEPS = 20;
  const step = (n: number) =>
    [
      `## Step ${n}`,
      "",
      "### Action",
      "",
      `Clic droit sur le disjoncteur D ${n} de la vue de traction.`,
      "",
      "### Expected Result",
      "",
      "Le menu propose Ouvrir, Fermer et Propriétés.",
      "",
      "### Sources",
      "",
      '- SOSIE_211_D401-1_3#§5.6.7 "Son menu contextuel propose Ouvrir, Fermer et Propriétés"',
      "",
    ].join("\n");

  beforeEach(() => {
    const dir = join(project, "tests", "local-0a0b0c0d");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "test.md"),
      [
        "---",
        "project: LFRPS12",
        "summary: Disjoncteurs — menu contextuel de chacun",
        "folder: /Traction/Disjoncteurs",
        "labels: []",
        "review: draft",
        "---",
        "",
        "## Description",
        "",
        "Vérifie le menu contextuel de chaque disjoncteur de la vue de traction.",
        "",
        ...Array.from({ length: STEPS }, (_, i) => step(i + 1)),
      ].join("\n"),
    );
  });

  it(`a ${STEPS}-step test reads whole and the mechanical pass finds nothing`, async () => {
    expect(readTest(project, "local-0a0b0c0d").test.steps).toHaveLength(STEPS);
    expect(mechanicalCheck(project, "local-0a0b0c0d")).toEqual([]);
    const r = (await invoke("check.run", { ids: ["local-0a0b0c0d"], semantic: false }, { project })) as {
      tests: { id: string; findings: unknown[] }[];
    };
    expect(r.tests).toMatchObject([{ id: "local-0a0b0c0d" }]);
    expect(JSON.stringify(r.tests)).not.toMatch(/"severity":"error"/);
  });
});
