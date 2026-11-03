import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ids = vi.hoisted(() => ({ next: [] as string[] }));
vi.mock("../../../../src/core/lib/store.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/core/lib/store.ts")>();
  return { ...real, hex8: () => ids.next.shift() ?? real.hex8() };
});

import { quietCtx } from "../../../../src/core/command.ts";
import { commands } from "../../../../src/core/commands/contexts.ts";

const FIXTURE = resolve(import.meta.dirname, "..", "..", "..", "fixtures", "project");
let P = "";

const run = async <T>(name: string, input: unknown = {}): Promise<T> => {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return (await c.run(quietCtx(P), c.input.parse(input) as never)) as T;
};
type Detail = { id: string; name: string; files: string[] };

beforeEach(() => {
  P = mkdtempSync(join(tmpdir(), "testimus-cov-ctx-"));
  cpSync(FIXTURE, P, { recursive: true });
});
afterEach(() => {
  ids.next = [];
  rmSync(P, { recursive: true, force: true });
});

describe("contexts — the less common inputs", () => {
  it("draws another id when the first one is taken", async () => {
    ids.next = ["aaaaaaaa", "aaaaaaaa", "bbbbbbbb"];
    expect((await run<Detail>("contexts.create")).id).toBe("ctx-aaaaaaaa");
    expect((await run<Detail>("contexts.create", { name: "Deux" })).id).toBe("ctx-bbbbbbbb");
  });

  it("a blank new name keeps the old one", async () => {
    const c = await run<Detail>("contexts.create", { name: "Glossaire" });
    expect((await run<Detail>("contexts.set", { id: c.id, name: "  " })).name).toBe("Glossaire");
    expect((await run<Detail & { notes: string }>("contexts.set", { id: c.id, notes: "n" })).notes).toBe("n");
  });

  it("an upload without a usable name is called file, without extension, numbered when taken", async () => {
    const c = await run<Detail>("contexts.create");
    const data = Buffer.from("x").toString("base64");
    expect((await run<{ added: string }>("contexts.addFile", { id: c.id, dataBase64: data })).added).toBe("file");
    expect((await run<{ added: string }>("contexts.addFile", { id: c.id, dataBase64: data })).added).toBe("file (2)");
    expect((await run<{ added: string }>("contexts.addFile", { id: c.id, name: "/", dataBase64: data })).added).toBe(
      "file (3)",
    );
    const dotted = join(P, "..", ".notes");
    writeFileSync(dotted, "n");
    await run("contexts.addFile", { id: c.id, file: dotted });
    expect((await run<{ added: string }>("contexts.addFile", { id: c.id, file: dotted })).added).toBe(".notes (2)");
    rmSync(dotted);
    expect(existsSync(join(P, "contexts", c.id, "files", ".notes (2)"))).toBe(true);
  });

  it("setTest refuses an unknown test", async () => {
    await expect(run("contexts.setTest", { testId: "NOPE-1", contexts: [] })).rejects.toThrow(/No test NOPE-1/);
  });
});
