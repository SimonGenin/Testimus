import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseProposal, proposeTrace, tracePrompt } from "../../src/core/claude/traces.ts";
import { invoke } from "../../src/core/commands/index.ts";
import { type ClaudeOut, env } from "../../src/core/env.ts";
import { columnGuidance } from "../../src/core/lib/columns.ts";
import { DEFAULT_SETTINGS, readProject, writeSettings, writeXray } from "../../src/core/lib/project.ts";
import {
  checkTrace,
  compile,
  detectedTraces,
  LEGACY_PATTERN,
  projectTraces,
  REQUIREMENT,
  removeTrace,
  requirementPatterns,
  saveTrace,
  scanTrace,
  traceViews,
} from "../../src/core/lib/traces.ts";

const real = env.spawnClaude;
let dir = "";

const write = (rel: string, text: string) => {
  const file = join(dir, rel);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
};
const project = (json: Record<string, unknown> = {}) =>
  write("project.json", JSON.stringify({ name: "t", jiraProject: "T", ...json }));
const xray = (custom: string[] = []) =>
  writeXray(dir, {
    fields: [
      { id: "action", name: "Action", type: "text", builtin: true },
      { id: "result", name: "Expected Result", type: "text", builtin: true },
      ...custom.map((name, i) => ({ id: `cf${i}`, name, type: "text", builtin: false })),
    ],
    prefs: { order: [], collapsed: [], hidden: [] },
  });
const run = (name: string, input: unknown = {}) => invoke(name, input, { project: dir, wait: true });
const resultLine = (r: string, ok = true) =>
  JSON.stringify({
    type: "result",
    subtype: ok ? "success" : "error_during_execution",
    is_error: !ok,
    result: r,
    duration_ms: 3,
    total_cost_usd: 0.01,
  });
const answer = (out: Partial<ClaudeOut>) => {
  env.spawnClaude = async () => ({ code: 0, stdout: "", stderr: "", ...out });
};
const proposal = (o: unknown) => `\`\`\`trace\n${JSON.stringify(o)}\n\`\`\``;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "testimus-cov-traces-"));
  project();
  xray();
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
});
afterEach(() => {
  env.spawnClaude = real;
  rmSync(dir, { recursive: true, force: true });
});

describe("compile and checkTrace", () => {
  it("refuses no pattern, a broken one and one matching empty text", () => {
    expect(() => compile([" ", ""])).toThrow(/No pattern given/);
    expect(() => compile(["("])).toThrow(/Not a valid pattern: \(/);
    expect(() => compile(["a*"])).toThrow(/matches empty text/);
    expect("ALM-1 ALM-1".match(compile(["ALM-\\d", "ALM-\\d"]))).toEqual(["ALM-1", "ALM-1"]);
  });

  it("refuses a trace without name, without column or on a standard column", () => {
    const t = { label: "Alarme", patterns: ["ALM-\\d+"], field: "Alarme" };
    expect(() => checkTrace({ ...t, label: " " })).toThrow(/need a name/);
    expect(() => checkTrace({ ...t, field: " " })).toThrow(/need a step column/);
    expect(() => checkTrace({ ...t, field: "Expected Result" })).toThrow(/standard step field/);
    expect(() => checkTrace(t)).not.toThrow();
  });
});

describe("scanTrace", () => {
  beforeEach(() => {
    write(
      "docs/A/doc.md",
      [
        "Avant toute section ALM-1.",
        "",
        "## 1 Alarmes <!-- § 1 -->",
        "",
        `${"texte ".repeat(40)}ALM-2 ${"suite ".repeat(40)}`,
        "<!-- ALM-9 seulement dans un commentaire -->",
        "ALM-2 encore et ALM-10.",
        `ALM-11 ${"fin ".repeat(60)}`,
      ].join("\n"),
    );
    write("docs/B/doc.md", "## 1 Rien <!-- § 1 -->\n\nAucun code ici.\n");
    mkdirSync(join(dir, "docs", "EMPTY"), { recursive: true });
  });

  it("counts every occurrence, keeps the first place of each id, cuts long lines and skips other documents", () => {
    const s = scanTrace(dir, [String.raw`\bALM-\d+`]);
    expect(s).toMatchObject({ total: 5, distinct: 4, docs: [{ doc: "A", count: 5, distinct: 4 }] });
    expect(s.items.map((i) => `${i.id} ${i.anchor}`)).toEqual(["ALM-1 ", "ALM-2 §1", "ALM-10 §1", "ALM-11 §1"]);
    const long = s.items[1].context;
    expect(long.startsWith("…") && long.endsWith("…")).toBe(true);
    expect(scanTrace(dir, [String.raw`\bALM-\d+`], { doc: "B" })).toMatchObject({ total: 0, items: [] });
    expect(scanTrace(dir, [String.raw`\bALM-\d+`], { limit: 1 }).items).toHaveLength(1);
  });

  it("with the csv: its text replaces the context, its ids are added unless one document is asked", () => {
    write(
      "requirements/requirements.csv",
      "id;texte\nALM-1;Le texte du csv\nALM-77;Seulement au csv\nALM-2;\n;vide\nALM-78\n",
    );
    const s = scanTrace(dir, [String.raw`\bALM-\d+`], { csv: true });
    expect(s.items.find((i) => i.id === "ALM-1")?.context).toBe("Le texte du csv");
    expect(s.items.find((i) => i.id === "ALM-77")).toEqual({
      id: "ALM-77",
      doc: "",
      anchor: "",
      context: "Seulement au csv",
    });
    expect(s.items.find((i) => i.id === "ALM-2")?.context).not.toBe("");
    const one = scanTrace(dir, [String.raw`\bALM-\d+`], { csv: true, doc: "A" });
    expect(one.items.some((i) => i.id === "ALM-77")).toBe(false);
    write("requirements/requirements.csv", "code\nALM-5\n");
    expect(scanTrace(dir, [String.raw`\bALM-\d+`], { csv: true }).items.find((i) => i.id === "ALM-5")?.context).toBe(
      "",
    );
  });

  it("without docs nor csv finds nothing", () => {
    rmSync(join(dir, "docs"), { recursive: true });
    expect(scanTrace(dir, ["X-\\d"], { csv: true })).toEqual({ total: 0, distinct: 0, docs: [], items: [] });
  });
});

describe("detected and declared traces", () => {
  it("a project with no evidence of requirements tracks nothing", () => {
    expect(detectedTraces(dir)).toEqual([]);
    expect(traceViews(dir)).toEqual([]);
  });

  it("only a project from before tracked ids gets RATP's requirements: its old keys or its requirement anchors", () => {
    project({ requirementField: " Req ", requirementPatterns: ["REQ-\\d+"] });
    expect(detectedTraces(dir)[0]).toMatchObject({ field: "Req", patterns: [LEGACY_PATTERN, "REQ-\\d+"] });
    project();
    xray(["Requirement id"]);
    expect(detectedTraces(dir)).toEqual([]);
    write("docs/A/doc.md", "<!-- req EXI_A_1 -->\n");
    expect(detectedTraces(dir)[0]).toMatchObject({ field: "Requirement id", patterns: [LEGACY_PATTERN] });
    xray();
    expect(detectedTraces(dir)[0].field).toBe("Exigence");
  });

  it("views say declared or detected, in Xray or local, and survive a broken pattern", () => {
    project({ traces: [{ id: "alm", label: "Alarme", patterns: ["("], field: "Alarme" }] });
    xray(["Alarme"]);
    expect(traceViews(dir)).toEqual([
      {
        id: "alm",
        label: "Alarme",
        patterns: ["("],
        field: "Alarme",
        origin: "declared",
        column: "in-xray",
        found: 0,
        docs: 0,
      },
    ]);
  });
});

describe("saveTrace and removeTrace", () => {
  const alarm = { label: "Code alarme", patterns: [" ALM-\\d+ ", "ALM-\\d+"], field: "Alarme" };

  it("adds with a slug key, a suffix when taken, keeps the ask, and changes one by its key", () => {
    let list = saveTrace(dir, { ...alarm, ask: "  les alarmes " });
    expect(list).toEqual([
      { id: "code-alarme", label: "Code alarme", patterns: ["ALM-\\d+"], field: "Alarme", ask: "les alarmes" },
    ]);
    list = saveTrace(dir, { ...alarm, field: "Alarme 2", ask: " " });
    expect(list.map((t) => t.id)).toEqual(["code-alarme", "code-alarme-2"]);
    expect(list[1].ask).toBeUndefined();
    list = saveTrace(dir, { ...alarm, id: "code-alarme", label: "Alarme" });
    expect(list[0].label).toBe("Alarme");
    expect(saveTrace(dir, { label: "***", patterns: ["Z-\\d"], field: "Z" }).at(-1)?.id).toBe("ids");
  });

  it("refuses an unknown key and a column another trace holds", () => {
    saveTrace(dir, alarm);
    expect(() => saveTrace(dir, { ...alarm, id: "nope" })).toThrow(/No tracked ids called nope/);
    expect(() => saveTrace(dir, { ...alarm, label: "Autre", field: " alarme " })).toThrow(/already holds/);
  });

  it("a save declares the list and drops the old requirement keys", () => {
    project({ requirementField: "Exigence", requirementPatterns: ["REQ-\\d+"] });
    saveTrace(dir, { id: REQUIREMENT, label: "Exigence", patterns: ["REQ-\\d+"], field: "Exigence" });
    expect(readProject(dir).requirementField).toBeUndefined();
    expect(readProject(dir).requirementPatterns).toBeUndefined();
    expect(projectTraces(dir)).toMatchObject({ declared: true, traces: [{ id: REQUIREMENT, patterns: ["REQ-\\d+"] }] });
    expect(requirementPatterns(dir)).toEqual(["REQ-\\d+"]);
    removeTrace(dir, REQUIREMENT);
    expect(requirementPatterns(dir)).toEqual([]);
  });

  it("a new kind named like requirements is the requirement trace while the project has none", () => {
    expect(saveTrace(dir, { label: "Exigence", patterns: ["REQ-\\d+"], field: "Exigence" })[0].id).toBe(REQUIREMENT);
    expect(saveTrace(dir, { label: "Exigence client", patterns: ["C-\\d+"], field: "Client" })[1].id).toBe(
      "exigence-client",
    );
    expect(saveTrace(dir, { label: "Code", patterns: ["K-\\d+"], field: "Requirement 2" })[2].id).toBe("code");
  });

  it("removes by key and refuses an unknown one", () => {
    saveTrace(dir, alarm);
    expect(removeTrace(dir, "code-alarme")).toEqual([]);
    expect(() => removeTrace(dir, "code-alarme")).toThrow(/No tracked ids called code-alarme/);
  });
});

describe("columnGuidance", () => {
  it("no id lines without traces; a broken pattern gives no examples and no ids; the scope lists its ids", () => {
    expect(columnGuidance(dir).join("\n")).not.toContain("Ids only");
    project({
      traces: [
        { id: REQUIREMENT, label: "Exigence", patterns: [LEGACY_PATTERN], field: "Exigence" },
        { id: "alm", label: "Alarme", patterns: ["("], field: "Alarme" },
        { id: "uc", label: "Cas", patterns: ["UC-\\d+"], field: "Cas" },
      ],
    });
    write("docs/D/doc.md", "# D\n\n## 1 Un <!-- § 1 -->\n\nUC-1 et UC-2.\n\n## 2 Deux <!-- § 2 -->\n\nUC-3.\n");
    const lines = columnGuidance(dir, { docs: [], sections: ["D#§1"] });
    const alarme = lines.findIndex((l) => l.startsWith("- ### Alarme:"));
    expect(lines[alarme + 1]).toMatch(/^ {2}Ids only as the documents write them \(pattern \(\); leave/);
    expect(lines[alarme + 2] ?? "").not.toMatch(/Alarme ids written/);
    expect(lines.join("\n")).toContain("Cas ids written in the scope, each to be verified");
    expect(lines.join("\n")).toMatch(/cannot cover\): UC-1, UC-2$/m);
  });
});

describe("proposals", () => {
  it("the prompt names the existing custom columns only when there are some", () => {
    expect(tracePrompt(" x ", "en", [])).not.toContain("reuse one of these");
    expect(tracePrompt("x", "fr", ["Alarme"])).toContain(
      "reuse one of these existing custom columns when it fits: Alarme",
    );
  });

  it("parseProposal prefers the trace block, skips non-objects, and reads missing fields as empty", () => {
    expect(parseProposal('```json\n{"label":"B"}\n```\n```trace\nnull\n```')).toEqual({
      label: "B",
      patterns: [],
      field: "",
      why: "",
    });
    expect(parseProposal('```trace\n{"label":1,"patterns":"x"}\n```')).toEqual({
      label: "",
      patterns: [],
      field: "",
      why: "",
    });
    expect(parseProposal("```trace\nnot json\n```")).toBeNull();
  });

  it("a failed run, a reply without block, a broken pattern and a proposal without column", async () => {
    answer({ code: 1, stdout: `${resultLine("boom", false)}\n` });
    expect(await proposeTrace({ project: dir, ask: "alarmes" })).toMatchObject({ ok: false, proposal: null });
    answer({ stdout: `${resultLine("rien")}\n` });
    expect(await proposeTrace({ project: dir, ask: "alarmes" })).toMatchObject({ ok: false, proposal: null });
    answer({ stdout: `${resultLine(proposal({ label: "A", patterns: ["("], field: "", why: "vu" }))}\n` });
    const broken = await proposeTrace({ project: dir, ask: "alarmes", model: "haiku" });
    expect(broken).toMatchObject({ ok: true, preview: null, column: null });
    expect(broken.proposal?.why).toMatch(/^vu \(Not a valid pattern/);
    xray(["Alarme"]);
    answer({ stdout: `${resultLine(proposal({ label: "A", patterns: [], field: "Action", why: "" }))}\n` });
    expect(await proposeTrace({ project: dir, ask: "alarmes" })).toMatchObject({
      ok: true,
      preview: null,
      column: "in-xray",
    });
  });
});

describe("traces commands", () => {
  it("traces.find with patterns, with a tracked kind, and refuses an unknown kind", async () => {
    write("docs/A/doc.md", "## 1 A <!-- § 1 -->\n\nEXI_A_1 et ALM-3.\n");
    project({ traces: [{ id: "alm", label: "Alarme", patterns: ["ALM-\\d+"], field: "Alarme" }] });
    expect(await run("traces.find", { patterns: ["EXI_\\w+"] })).toMatchObject({ distinct: 1 });
    expect(await run("traces.find", { trace: "alm" })).toMatchObject({ items: [{ id: "ALM-3" }] });
    await expect(run("traces.find", { trace: "nope" })).rejects.toThrow(/No tracked ids called nope/);
    await expect(run("traces.find", {})).rejects.toThrow(/No pattern given/);
  });
});
