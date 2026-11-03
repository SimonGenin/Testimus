import { beforeEach, describe, expect, it, vi } from "vitest";
import { type Command, quietCtx } from "../../../../src/core/command.ts";
import { commands as claudeCommands } from "../../../../src/core/commands/claude.ts";
import { commands as ragIndexCommands } from "../../../../src/core/commands/rag-index.ts";
import { env } from "../../../../src/core/env.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import { copyFixture, tempRoot } from "../../cov-faces-helpers.ts";
import "../../../../src/core/commands/index.ts";

const active = vi.hoisted(() => ({ embedding: null as unknown }));

vi.mock("../../../../src/core/rag/activation.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  activeModels: async () => ({
    embedding: active.embedding,
    reranker: null,
    choice: null,
    source: "none",
    missing: ["bge-m3"],
  }),
}));

const all: Command[] = [...ragIndexCommands, ...claudeCommands];
const cmd = (name: string) => {
  const c = all.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return c;
};
const run = async (name: string, raw: unknown = {}): Promise<any> => {
  const c = cmd(name);
  return c.run(quietCtx(project), c.input.parse(raw) as never);
};

let project = "";
beforeEach(() => {
  project = copyFixture(tempRoot("ragcmd"));
  active.embedding = null;
});

describe("claude.run subject", () => {
  it("names the scope of the run", () => {
    const c = cmd("claude.run");
    const subject = (scope: unknown) => c.subject?.(c.input.parse({ prompt: "p", scope }) as never);
    expect(subject({ kind: "tests", testIds: ["a", "b"] })).toBe("2 tests");
    expect(subject({ kind: "project" })).toBe("project");
    expect(subject({ kind: "test", testId: "local-1" })).toBe("local-1");
    expect(subject({ kind: "step", testId: "local-1", step: 2 })).toBe("local-1 step 2");
  });
});

describe("claude.run on the whole project", () => {
  it("runs with the project's contexts", async () => {
    const real = env.spawnClaude;
    env.spawnClaude = mockSpawnClaude;
    try {
      const r = await run("claude.run", { scope: { kind: "project" }, prompt: "Relis." });
      expect(r).toHaveProperty("ok");
      expect(r).toHaveProperty("runId");
    } finally {
      env.spawnClaude = real;
    }
  });
});
