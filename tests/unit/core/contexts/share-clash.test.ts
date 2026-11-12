import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sharedContexts, writeContextFile } from "../../../../src/core/claude/prompt.ts";
import { createContext, shareContext, showContext } from "../../../../src/core/lib/contexts.ts";

const FIXTURE = resolve(import.meta.dirname, "../../../fixtures/project");
let P = "";

beforeEach(() => {
  P = mkdtempSync(join(tmpdir(), "testimus-share-"));
  cpSync(FIXTURE, P, { recursive: true });
});
afterEach(() => {
  rmSync(P, { recursive: true, force: true });
  rmSync(sharedContexts(), { recursive: true, force: true });
});

describe("sharing a context whose id the library already holds", () => {
  it("is refused, and the project's context stays where it is", async () => {
    const mine = createContext(P, { name: "Positions", notes: "mine" });
    writeContextFile(join(sharedContexts(), mine.id), { name: "Someone else's", paths: [], notes: "theirs" });
    await expect(shareContext(P, mine.id, true)).rejects.toThrow(`A context ${mine.id} is already there.`);
    expect(existsSync(join(P, "contexts", mine.id, "context.md"))).toBe(true);
    expect(showContext(P, mine.id)).toMatchObject({ name: "Positions", shared: false, notes: "mine" });
  });

  it("asking for the state it already has changes nothing", async () => {
    const mine = createContext(P, { name: "Positions", notes: "mine" });
    expect(await shareContext(P, mine.id, false)).toMatchObject({ id: mine.id, shared: false });
    expect(existsSync(join(P, "contexts", mine.id))).toBe(true);
  });
});
