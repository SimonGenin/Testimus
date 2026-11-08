import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mcpAccess, protectedRules } from "../../../../src/core/claude/access.ts";
import { OVERVIEW_MARKER } from "../../../../src/core/claude/overview.ts";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { listJobs, waitJob } from "../../../../src/core/jobs.ts";
import {
  basisOf,
  changesSince,
  formatOverview,
  OVERVIEW_LINE,
  overviewFile,
  overviewGiven,
  overviewWarnings,
  parseOverview,
  readOverview,
  sectionDiff,
  sectionsOf,
  withOverview,
} from "../../../../src/core/lib/overview.ts";
import { readProject, writeProject } from "../../../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-overview.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";
import { call, fixtureCopy } from "../registry.ts";

const real = env.spawnClaude;
let sent: ClaudeSpawn[] = [];

afterEach(() => {
  env.spawnClaude = real;
  resetProbe();
  sent = [];
});

function mockClaude(change?: (s: ClaudeSpawn) => void) {
  env.spawnClaude = async (s) => {
    if (!s.args.includes("--version")) sent.push(s);
    const out = await mockSpawnClaude(s);
    if (s.stdin.startsWith(OVERVIEW_MARKER)) change?.(s);
    return out;
  };
}

const overviewRuns = () => sent.filter((s) => s.stdin.startsWith(OVERVIEW_MARKER));

function turnOn(P: string, inEveryRun = true) {
  const p = readProject(P);
  writeProject(P, { ...p, claude: { ...p.claude, overview: { enabled: true, inEveryRun } } });
}

async function overviewDone(P: string, n = 1) {
  await vi.waitFor(() => expect(listJobs(P).filter((j) => j.kind === "docs.overview").length).toBe(n), {
    timeout: 10_000,
  });
  for (const j of listJobs(P).filter((x) => x.kind === "docs.overview")) await waitJob(j.id);
}

function client(names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "testimus-client-"));
  for (const n of names) writeFileSync(join(dir, `${n}.docx`), sampleDocx());
  return dir;
}

const BODY = [
  "Intro written by hand.",
  "",
  "## Traction <!-- doc A -->",
  "",
  "A is the traction spec.",
  "",
  "### Detail",
  "Still A.",
  "",
  "## Signalisation <!-- doc B -->",
  "",
  "B is the signalling spec.",
  "",
  "## Les liens",
  "",
  "A refers to B.",
  "",
].join("\n");

describe("docs/OVERVIEW.md, the file", () => {
  it("keeps its frontmatter through a round trip and cuts the body at ## only", () => {
    const meta = {
      updatedAt: "2026-11-08T11:02:00.000Z",
      updatedAfter: "Import of 3 documents",
      basis: { A: "aaaaaaaaaaaa", "B.v2": "bbbbbbbbbbbb" },
      modified: ["Ce qui: se contredit"],
      added: ["Poste de commande"],
    };
    const text = formatOverview(meta, BODY);
    expect(text.startsWith("---\nupdatedAt: 2026-11-08T11:02:00.000Z\n")).toBe(true);
    expect(parseOverview(text)).toEqual({ meta, body: BODY });
    const s = sectionsOf(BODY);
    expect(s.map((x) => [x.key, x.title, x.doc ?? null])).toEqual([
      ["", "", null],
      ["doc:A", "Traction", "A"],
      ["doc:B", "Signalisation", "B"],
      ["title:les liens", "Les liens", null],
    ]);
    expect(s[1].text).toContain("### Detail");
    expect(parseOverview("no frontmatter")).toEqual({ meta: { basis: {} }, body: "no frontmatter" });
  });

  it("says which sections an update changed, added and removed, and which it should not have touched", () => {
    const before = sectionsOf(BODY);
    const after = sectionsOf(
      BODY.replace("B is the signalling spec.", "B, version 2.")
        .replace("A is the traction spec.", "A  is the traction\nspec.")
        .replace("## Les liens", "## Poste <!-- doc C -->\n\nC.\n\n## Les liens"),
    );
    expect(sectionDiff(before, after)).toEqual({ modified: ["Signalisation"], added: ["Poste"], removed: [] });
    expect(overviewWarnings(before, after, [{ id: "B", change: "converted", title: "Signalisation" }])).toEqual([]);
    expect(overviewWarnings(before, after, [{ id: "C", change: "added", title: "Poste" }])).toEqual([
      "Claude changed the section « Signalisation », though its document did not change.",
    ]);
    const gone = sectionsOf(BODY.replace(/## Traction[\s\S]*?(?=## Signalisation)/, ""));
    expect(
      overviewWarnings(before, gone, [
        { id: "D", change: "added", title: "Doc D" },
        { id: "B", change: "removed", title: "B" },
      ]),
    ).toEqual([
      "Claude removed the section « Traction », though its document did not change.",
      "No section for « Doc D », added since the last update.",
      "The section of B is still there, though it was removed.",
    ]);
  });

  it("computes what changed since its basis: added, converted again, removed", () => {
    const P = fixtureCopy("overview-basis");
    const now = basisOf(P);
    expect(Object.keys(now).length).toBe(5);
    const [first, second] = Object.keys(now);
    const basis = { ...now, [second]: "000000000000", GONE: "111111111111" };
    delete basis[first];
    expect(changesSince(P, basis, now).map((c) => [c.id, c.change])).toEqual([
      [first, "added"],
      [second, "converted"],
      ["GONE", "removed"],
    ]);
    expect(changesSince(P, now, basisOf(P))).toEqual([]);
  });
});

describe("docs.overview after an import", () => {
  it("is neither written nor given while the option is off", async () => {
    const P = fixtureCopy("overview-off");
    mockClaude();
    await call("docs.addFolder", { dir: client(["SPEC_K_01_00"]), describeFigures: false }, P);
    await new Promise((r) => setTimeout(r, 400));
    expect(listJobs(P).some((j) => j.kind === "docs.overview")).toBe(false);
    expect(existsSync(overviewFile(P))).toBe(false);
    await expect(call("docs.overview", { mode: "full" }, P)).rejects.toMatchObject({ code: "overview-off" });
    writeFileSync(overviewFile(P), "## Hand written\n");
    expect(withOverview(P, "chat", "Question?\n")).toBe("Question?\n");
    const shown = await call<{ enabled: boolean; exists: boolean }>("docs.overviewShow", {}, P);
    expect([shown.enabled, shown.exists]).toEqual([false, true]);
  });

  it("makes one Claude run for a batch, then only the sections a later import touches change", async () => {
    const P = fixtureCopy("overview-batch");
    turnOn(P);
    mockClaude();
    await call(
      "docs.addFolder",
      { dir: client(["SPEC_K_01_00", "SPEC_L_01_00", "SPEC_M_01_00"]), describeFigures: false },
      P,
    );
    await overviewDone(P);
    expect(overviewRuns().length).toBe(1);
    expect(overviewRuns()[0].stdin).toContain("to write docs/OVERVIEW.md");
    const first = readOverview(P);
    expect(Object.keys(first.meta.basis).sort()).toEqual(Object.keys(basisOf(P)).sort());
    expect(sectionsOf(first.body).filter((s) => s.doc).length).toBe(8);
    expect([first.meta.updatedAfter, first.meta.kind]).toEqual(["Its first writing", "first"]);

    await call("docs.addFolder", { dir: client(["SPEC_N_01_00"]), describeFigures: false }, P);
    await overviewDone(P, 2);
    expect(overviewRuns().length).toBe(2);
    const update = overviewRuns()[1].stdin;
    expect(update).toContain("to update docs/OVERVIEW.md");
    expect(update).toContain("- added: SPEC_N — «");
    expect(update).not.toContain("- SPEC_K —");
    const second = readOverview(P);
    const before = new Map(sectionsOf(first.body).map((s) => [s.key, s.text]));
    for (const s of sectionsOf(second.body).filter((x) => x.doc && x.doc !== "SPEC_N"))
      expect(s.text).toBe(before.get(s.key));
    expect(second.meta.added).toEqual([expect.stringMatching(/./)]);
    expect(second.meta.modified).toEqual(["Le corpus", "Les liens"]);
    expect(second.meta.updatedAfter).toMatch(/^Import of « /);
    expect(second.meta.kind).toBe("import");
    const shown = await call<{ pending: unknown[]; last: { before: string } | null }>("docs.overviewShow", {}, P);
    expect(shown.pending).toEqual([]);
    expect(shown.last?.before).toBe(first.body);
  });

  it("warns when Claude changed a section whose document did not change", async () => {
    const P = fixtureCopy("overview-warn");
    turnOn(P);
    mockClaude();
    await call("docs.overview", { mode: "full" }, P);
    mockClaude((s) => {
      const f = overviewFile(s.cwd);
      writeFileSync(f, readFileSync(f, "utf8").replace(/(<!-- doc [^>]+-->\n\n)/, "$1Réécrit sans raison. "));
    });
    await call("docs.addFolder", { dir: client(["SPEC_P_01_00"]), describeFigures: false }, P);
    await overviewDone(P, 2);
    const job = listJobs(P).find((j) => j.kind === "docs.overview" && j.subject === "auto");
    const r = (await waitJob(job?.id ?? "")) as { warnings: string[] };
    expect(r.warnings).toEqual([expect.stringMatching(/^Claude changed the section « .* », though its document/)]);
  });

  it("is told to every run while inEveryRun is on, never to a figure reading", async () => {
    const P = fixtureCopy("overview-every");
    turnOn(P, true);
    expect(overviewGiven(P)).toBe(false);
    turnOn(P, false);
    writeFileSync(overviewFile(P), "## A <!-- doc A -->\n");
    expect(overviewGiven(P)).toBe(false);
    expect(withOverview(P, "chat", "Q\n")).toBe("Q\n");
    turnOn(P, true);
    expect(overviewGiven(P)).toBe(true);
    expect(withOverview(P, "chat", "Q\n")).toBe(`Q\n\n${OVERVIEW_LINE}\n`);
    expect(withOverview(P, "figures", "Q\n")).toBe("Q\n");
    mockClaude();
    await call("chat.ask", { question: "Que dit le §5.6.6 ?" }, P);
    expect(sent.at(-1)?.stdin.endsWith(`${OVERVIEW_LINE}\n`)).toBe(true);
  });
});

describe("who may write docs/OVERVIEW.md", () => {
  it("only the overview's own run, and no run through the commands", async () => {
    await import("../../../../src/core/commands/index.ts");
    expect(protectedRules([], "overview")).toContain("Edit(docs/*/**)");
    expect(protectedRules([], "overview")).not.toContain("Edit(docs/**)");
    for (const kind of ["generate", "action", "chat"] as const) {
      expect(protectedRules([], kind)).toContain("Write(docs/**)");
      expect(mcpAccess(kind).deny).toEqual(
        expect.arrayContaining(["mcp__testimus__docs_overview", "mcp__testimus__docs_overviewSave"]),
      );
      expect(mcpAccess(kind).allow).toContain("mcp__testimus__docs_overviewShow");
    }
  });
});
