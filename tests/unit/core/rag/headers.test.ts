import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claudeHeaders,
  HEADERS_BATCH,
  HEADERS_MARKER,
  headersPrompt,
  parseHeaders,
  projectOfDoc,
} from "../../../../src/core/claude/headers.ts";
import { quietCtx } from "../../../../src/core/command.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import {
  DEFAULT_SETTINGS,
  readJson,
  readProject,
  writeProject,
  writeSettings,
} from "../../../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-gen.ts";
import { chunkDoc } from "../../../../src/core/rag/chunk.ts";
import { openDb } from "../../../../src/core/rag/db.ts";
import { indexProject } from "../../../../src/core/rag/indexer.ts";
import type { Chunk, DocJson, FigureEntry } from "../../../../src/core/types.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const D3 = "SOSIE_211_D401-1_3";
const real = { spawn: env.spawnClaude };
let dir: string;
let seen: ClaudeSpawn[];

function doc3(): { doc: DocJson; chunks: Chunk[] } {
  const d = join(dir, "docs", D3);
  const doc = { ...readJson<DocJson>(join(d, "doc.json"), {} as DocJson), id: D3 };
  const chunks = chunkDoc(
    doc,
    readFileSync(join(d, "doc.md"), "utf8"),
    readJson<FigureEntry[]>(join(d, "figures.json"), []),
  );
  return { doc, chunks };
}

function enable(on: boolean) {
  const p = readProject(dir);
  writeProject(dir, { ...p, rag: { ...p.rag, claudeHeaders: on } as typeof p.rag });
}

function spy() {
  env.spawnClaude = async (s): Promise<ClaudeOut> => {
    seen.push(s);
    return await mockSpawnClaude(s);
  };
}

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-headers-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  seen = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" }, lastProject: dir, projects: [dir] });
  env.mock = true;
});

afterEach(() => {
  env.spawnClaude = real.spawn;
  env.mock = false;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("Claude context headers (rag.index hands claudeHeaders to the indexer)", () => {
  it("the indexer alone never asks Claude, even when rag.claudeHeaders is on", async () => {
    enable(true);
    spy();
    await indexProject(dir, quietCtx(dir));
    expect(seen).toHaveLength(0);
  });

  it("prompts with every chunk id and its text, and parses the headers block by id", () => {
    const { doc, chunks } = doc3();
    const p = headersPrompt(doc, chunks, "fr");
    expect(p.startsWith(`${HEADERS_MARKER} for the document ${D3} Traction.`)).toBe(true);
    for (const c of chunks) expect(p).toContain(`=== ${c.id} (`);
    expect(p).toContain("in French");
    const got = parseHeaders(`\`\`\`headers\n{"${chunks[1].id}": " Une  phrase. "}\n\`\`\``, chunks);
    expect(got[1]).toBe("Une phrase.");
    expect(got.filter(Boolean)).toHaveLength(1);
    expect(parseHeaders("nothing", chunks)).toEqual(chunks.map(() => ""));
  });

  it("does nothing — no Claude run — while project.json rag.claudeHeaders is not true", async () => {
    spy();
    const { doc, chunks } = doc3();
    expect(await claudeHeaders(doc, chunks, new AbortController().signal, dir)).toEqual([]);
    expect(await claudeHeaders(doc, chunks, new AbortController().signal)).toEqual([]);
    enable(false);
    expect(await claudeHeaders(doc, chunks, new AbortController().signal)).toEqual([]);
    expect(seen).toHaveLength(0);
  });

  it("finds the project of a document from the known projects", () => {
    const { doc } = doc3();
    expect(projectOfDoc(doc)).toBe(dir);
    expect(projectOfDoc({ ...doc, converted: { with: "", at: "other", warnings: [] } })).toBeNull();
  });

  it("when enabled: one cheap run per batch, each header = default + Claude's sentence", async () => {
    enable(true);
    spy();
    const { doc, chunks } = doc3();
    const many = Array.from({ length: HEADERS_BATCH + 3 }, (_, i) => ({
      ...chunks[i % chunks.length],
      id: `${D3}#x${i}`,
    }));
    const got = await claudeHeaders(doc, many, new AbortController().signal);
    expect(seen).toHaveLength(2);
    expect(seen[0].args.slice(seen[0].args.indexOf("--model"), seen[0].args.indexOf("--model") + 4)).toEqual([
      "--model",
      "haiku",
      "--effort",
      "low",
    ]);
    expect(got).toHaveLength(many.length);
    expect(got[0]).toBe(
      `${many[0].header}\nCe passage du document situe ${many[0].path} dans la traction de la ligne.`,
    );
  });

  it("a failed run throws, so the indexer keeps the defaults and warns", async () => {
    enable(true);
    env.spawnClaude = async () => ({ code: 1, stdout: "", stderr: "Credit balance is too low" });
    const { doc, chunks } = doc3();
    await expect(claudeHeaders(doc, chunks, new AbortController().signal, dir)).rejects.toThrow(/Credit balance/);
  });

  it("through rag.index: headers in the index when enabled, defaults when not", async () => {
    spy();
    const headers = () => {
      const db = openDb(join(dir, "index", "rag.db"));
      try {
        return (db.prepare("select header from chunks where doc_id = ?").all(D3) as { header: string }[]).map(
          (r) => r.header,
        );
      } finally {
        db.close();
      }
    };
    await invoke("rag.index", {}, { project: dir });
    expect(seen).toHaveLength(0);
    expect(headers().every((h) => !h.includes("Ce passage"))).toBe(true);

    enable(true);
    await invoke("rag.index", { force: true }, { project: dir });
    expect(seen.length).toBeGreaterThan(0);
    expect(headers().every((h) => h.includes("Ce passage du document"))).toBe(true);

    seen.length = 0;
    await invoke("rag.index", { force: true, model: "sonnet", effort: "medium" }, { project: dir });
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen)
      expect(s.args.slice(s.args.indexOf("--model"), s.args.indexOf("--model") + 4)).toEqual([
        "--model",
        "sonnet",
        "--effort",
        "medium",
      ]);
  });
});
