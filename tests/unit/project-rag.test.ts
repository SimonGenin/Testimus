import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { invoke } from "../../src/core/commands/index.ts";

const fixture = join(import.meta.dirname, "..", "fixtures", "project");
const copy = () => {
  const dir = join(mkdtempSync(join(tmpdir(), "testimus-rag-")), "p");
  cpSync(fixture, dir, { recursive: true });
  return dir;
};
const rag = (dir: string) => JSON.parse(readFileSync(join(dir, "project.json"), "utf8")).rag;

describe("project.set rag switches", () => {
  it("sets describeFigures and claudeHeaders and keeps the other rag keys", async () => {
    const dir = copy();
    await invoke("project.set", { rag: { describeFigures: false } }, { project: dir });
    await invoke("project.set", { rag: { claudeHeaders: true } }, { project: dir });
    expect(rag(dir)).toEqual({ embedding: "bge-m3", reranker: null, describeFigures: false, claudeHeaders: true });
  });

  it("is reachable from the CLI with a dotted flag, no JSON needed", () => {
    const dir = copy();
    const cli = join(import.meta.dirname, "..", "..", "src", "faces", "cli.ts");
    execFileSync(
      process.execPath,
      [cli, "project", "set", "--project", dir, "--rag.describe-figures=false", "--json"],
      {
        env: { ...process.env, APPDATA: join(dir, "..", "appdata"), LOCALAPPDATA: join(dir, "..", "local") },
      },
    );
    expect(rag(dir).describeFigures).toBe(false);
  });
});
