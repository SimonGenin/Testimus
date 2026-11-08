import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { absRule, protectedRules } from "../../../../src/core/claude/access.ts";
import { afterOf, OVERVIEW_MARKER, overviewPrompt, prompts } from "../../../../src/core/claude/overview.ts";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { listJobs, startJob } from "../../../../src/core/jobs.ts";
import {
  formatOverview,
  overviewFile,
  parseOverview,
  readOverview,
  writeOverview,
} from "../../../../src/core/lib/overview.ts";
import { overviewAfterImport, overviewAsked } from "../../../../src/core/lib/overview-after.ts";
import { readProject, writeProject } from "../../../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-overview.ts";
import { call, fixtureCopy } from "../registry.ts";

const real = { spawn: env.spawnClaude, now: env.now };
let overviewRuns = 0;

afterEach(() => {
  env.spawnClaude = real.spawn;
  env.now = real.now;
  delete process.env.TESTIMUS_IN_CLAUDE;
  resetProbe();
  overviewRuns = 0;
});

function mockClaude(during?: (s: ClaudeSpawn) => Promise<void> | void, after?: (s: ClaudeSpawn) => string) {
  env.spawnClaude = async (s) => {
    const mine = s.stdin.startsWith(OVERVIEW_MARKER);
    if (mine) overviewRuns++;
    if (mine) await during?.(s);
    const out = await mockSpawnClaude(s);
    return mine && after ? { ...out, stdout: `${out.stdout}${after(s)}` } : out;
  };
}

function setOption(P: string, enabled: boolean) {
  const p = readProject(P);
  writeProject(P, { ...p, claude: { ...p.claude, overview: { enabled, inEveryRun: enabled } } });
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function blockingGeneration(P: string): () => Promise<unknown> {
  let end!: () => void;
  const job = startJob("generate", "a generation", P, () => new Promise<void>((r) => (end = r)));
  return () => {
    end();
    return job.done;
  };
}

const toolUse = (name: string, file_path: string, i: number) =>
  `${JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id: `stray-${i}`, name, input: { file_path } }] } })}\n`;

describe("the overview's run writes docs/OVERVIEW.md and nothing else", () => {
  it("closes tests/, eval/, test-runs/ and every other entry of the root and of docs/ by name", () => {
    const P = fixtureCopy("overview-rules");
    writeFileSync(join(P, "README.md"), "mine\n");
    writeFileSync(join(P, "docs", "NOTES.md"), "mine\n");
    mkdirSync(join(P, "exports"));
    const rules = protectedRules([], "overview", P);
    const root = absRule(P);
    expect(rules).toEqual(
      expect.arrayContaining([
        "Edit(tests/**)",
        "Write(eval/**)",
        "Write(test-runs/**)",
        "Edit(docs/*/**)",
        `Edit(${root}/README.md)`,
        `Write(${root}/docs/NOTES.md)`,
        `Write(${root}/exports/**)`,
      ]),
    );
    expect(rules.filter((r) => /OVERVIEW|\(docs\/\*\*\)/.test(r))).toEqual([]);
    expect(protectedRules([], "generate", P)).not.toContain("Edit(tests/**)");
  });

  it("fails the job when one of its writes went elsewhere, and puts back what it wrote", async () => {
    const P = fixtureCopy("overview-stray");
    setOption(P, true);
    writeFileSync(join(P, "README.md"), "mine\n");
    const md = join(P, "tests", "LFRPS12-1398", "test.md");
    const was = readFileSync(md, "utf8");
    mockClaude(undefined, (s) => {
      writeFileSync(join(s.cwd, "README.md"), "Claude\n");
      writeFileSync(md, "Claude\n");
      mkdirSync(join(s.cwd, "notes"));
      writeFileSync(join(s.cwd, "notes", "x.md"), "Claude\n");
      return [toolUse("Edit", "README.md", 1), toolUse("Write", md, 2), toolUse("Write", "notes/x.md", 3)].join("");
    });
    const err = await call("docs.overview", { mode: "full" }, P).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "overview-outside" });
    expect(String((err as Error).message)).toContain(
      "Claude wrote outside docs/OVERVIEW.md: README.md, notes/x.md, tests/LFRPS12-1398/test.md.",
    );
    expect(readFileSync(join(P, "README.md"), "utf8")).toBe("mine\n");
    expect(readFileSync(md, "utf8")).toBe(was);
    expect(existsSync(join(P, "notes"))).toBe(false);
    expect(existsSync(overviewFile(P))).toBe(false);
  });
});

describe("an update in its time", () => {
  it("shows the last update's changes only while the file says that update is the last", async () => {
    const P = fixtureCopy("overview-last");
    setOption(P, true);
    mockClaude();
    let t = Date.parse("2026-11-08T10:00:00.000Z");
    env.now = () => new Date(t++);
    await call("docs.overview", { mode: "full" }, P);
    const o = readOverview(P);
    const shown = await call<{ last: { at: string } | null }>("docs.overviewShow", {}, P);
    expect(shown.last?.at).toBe(o.meta.updatedAt);
    writeOverview(P, { ...o.meta, updatedAt: "2026-11-09T08:00:00.000Z" }, o.body);
    expect((await call<{ last: unknown }>("docs.overviewShow", {}, P)).last).toBeNull();
  });

  it("waits again for a generation begun while the update before it was writing", async () => {
    const P = fixtureCopy("overview-again");
    setOption(P, true);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockClaude(() => (overviewRuns === 1 ? gate : undefined));
    const first = call("docs.overview", { mode: "full" }, P);
    await vi.waitFor(() => expect(overviewRuns).toBe(1));
    const second = call("docs.overview", { mode: "full" }, P);
    await pause(400);
    const endGeneration = blockingGeneration(P);
    release();
    await first;
    await pause(400);
    expect(overviewRuns).toBe(1);
    await endGeneration();
    await second;
    expect(overviewRuns).toBe(2);
  });

  it("does nothing, without an error, when the option was turned off while it waited", async () => {
    const P = fixtureCopy("overview-turned-off");
    setOption(P, true);
    mockClaude();
    await call("docs.overview", { mode: "full" }, P);
    const o = readOverview(P);
    writeOverview(P, { ...o.meta, basis: {} }, o.body);
    const endGeneration = blockingGeneration(P);
    const update = call<{ ran: boolean }>("docs.overview", { mode: "auto" }, P);
    await pause(400);
    setOption(P, false);
    await endGeneration();
    expect(await update).toMatchObject({ ran: false });
    expect(overviewRuns).toBe(1);
  });

  it("is never asked from inside a Claude run (the MCP server); a CLI command waits for one it asked", async () => {
    const P = fixtureCopy("overview-inside");
    setOption(P, true);
    mockClaude();
    process.env.TESTIMUS_IN_CLAUDE = "1";
    overviewAfterImport(P);
    await overviewAsked(P);
    await pause(300);
    expect(listJobs(P).filter((j) => j.kind === "docs.overview")).toEqual([]);
    delete process.env.TESTIMUS_IN_CLAUDE;
    overviewAfterImport(P);
    await overviewAsked(P);
    expect(
      listJobs(P)
        .filter((j) => j.kind === "docs.overview")
        .map((j) => j.status),
    ).toEqual(["done"]);
    expect(overviewRuns).toBe(1);
  });
});

describe("what the update says", () => {
  it("leaves out the line on the other documents when none is left, and the template says {n}", () => {
    const changes = ["- added: A — « A »"];
    const docs = ["- A — « A » (Word)"];
    expect(overviewPrompt("auto", "fr", changes, docs, 0)).not.toContain("The other");
    expect(overviewPrompt("auto", "fr", changes, docs, 1)).toContain("The other document is unchanged");
    expect(overviewPrompt("auto", "fr", changes, docs, 3)).toContain("The other 3 documents are unchanged");
    const template = prompts.find((p) => p.id === "overview-update")?.text() ?? "";
    expect(template).toContain("The other {n} documents are unchanged");
  });

  it("keeps a kind in the frontmatter: import, conversion, removal, rewrite, first — none after mixed changes", () => {
    const one = (change: "added" | "converted" | "removed") => [{ id: "A", change, title: "Traction" }];
    expect(afterOf("auto", "auto", one("added"))).toEqual({ updatedAfter: "Import of « Traction »", kind: "import" });
    expect(afterOf("auto", "auto", one("converted")).kind).toBe("conversion");
    expect(afterOf("auto", "auto", one("removed")).kind).toBe("removal");
    expect(afterOf("full", "full", [])).toEqual({ updatedAfter: "A rewrite from scratch", kind: "rewrite" });
    expect(afterOf("auto", "full", [])).toEqual({ updatedAfter: "Its first writing", kind: "first" });
    expect(afterOf("auto", "auto", [...one("added"), { id: "B", change: "removed", title: "B" }])).toEqual({
      updatedAfter: "Changes to 2 documents",
    });
    const meta = {
      updatedAt: "2026-11-08T11:02:00.000Z",
      updatedAfter: "Import of 2 documents",
      kind: "import" as const,
    };
    const text = formatOverview({ ...meta, basis: {} }, "## A\n");
    expect(text).toContain("\nkind: import\n");
    expect(parseOverview(text).meta).toEqual({ ...meta, basis: {} });
    const old =
      "---\nupdatedAt: 2026-11-08T11:02:00.000Z\nupdatedAfter: Import of 2 documents\nkind: whatever\n---\n## A\n";
    expect(parseOverview(old).meta).toEqual({ updatedAt: meta.updatedAt, updatedAfter: meta.updatedAfter, basis: {} });
  });
});
