import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const root = mkdtempSync(join(tmpdir(), "testimus-cov-cli-"));

let out = "";
let err = "";
let exitCalls: number[] = [];
let sigint: ((...a: unknown[]) => void)[] = [];

async function freshEnv() {
  const { env } = await import("../../../src/core/env.ts");
  env.dataDir = () => join(root, "appdata");
  env.localDir = () => join(root, "localappdata");
  env.homeDir = () => join(root, "home");
  env.http = async (req) => {
    throw new Error(`no network: ${req.url}`);
  };
  env.spawnClaude = async () => {
    throw new Error("no claude");
  };
}

let actual: typeof import("../../../src/core/commands/index.ts");

// ponytail: the real registry is read once, before the tests — its first import transforms the whole command graph
// (every command, the core, the RAG runtimes: ~13 s cold on this Mac, more under load), work no test's 20 s should
// carry; evaluating it again for each run cost ~0.3 s more per run. Each run gets fresh only cli.ts and what it shares
// with the fake (command.ts, jobs.ts)
beforeAll(async () => {
  actual = await import("../../../src/core/commands/index.ts");
}, 120_000);

async function fakeRegistry() {
  const { UserError, command } = await import("../../../src/core/command.ts");
  const { startJob } = await import("../../../src/core/jobs.ts");
  const echo = command({
    name: "fake.run",
    summary: "Echo the parsed input.",
    input: z.object({
      list: z.array(z.string()).optional().describe("A list"),
      count: z.number().optional().describe("A number"),
      flag: z.boolean().optional(),
      dryRun: z.boolean().default(false).describe("Plan only"),
      obj: z.object({ a: z.number() }).optional().describe("An object"),
      rec: z.record(z.string(), z.string()).optional().describe("A record"),
      mode: z.enum(["a", "b"]).optional().describe("A mode"),
      name: z.string().nullable().optional().describe("A name"),
      any: z.union([z.number(), z.string()]).optional().describe("Anything"),
      result: z.unknown().optional().describe("What to return"),
      fail: z.string().optional().describe("Throw this"),
      deep: z.unknown().optional().describe("Nested"),
      nums: z.array(z.number()).optional().describe("Numbers"),
      cfg: z
        .object({ tag: z.string().optional(), on: z.boolean().optional(), names: z.record(z.string(), z.string()) })
        .optional()
        .describe("Typed nested"),
    }),
    output: z.unknown(),
    mutates: true,
    positional: ["name", "list"],
    async run() {
      return null;
    },
  });
  const bare = command({
    name: "fake.bare",
    summary: "No object input.",
    input: z.any(),
    output: z.unknown(),
    mutates: false,
    positional: ["ghost"],
    async run() {
      return null;
    },
  });
  const plain = command({
    name: "other.plain",
    summary: "No positional.",
    input: z.object({ id: z.string().describe("Id") }),
    output: z.unknown(),
    mutates: false,
    async run() {
      return null;
    },
  });
  const registry = [bare, echo, plain];
  const find = (name: string) => {
    const c = registry.find((x) => x.name === name);
    if (!c) throw new UserError(`Unknown command ${name}.`, "testimus help lists the commands.");
    return c;
  };
  const invoke = async (
    name: string,
    input: Record<string, unknown>,
    opts: {
      onProgress?(p: unknown): void;
      onLog?(l: string, m: string): void;
      onClaude?(e: unknown): void;
      project: string | null;
    },
  ) => {
    if (input.fail === "string") throw "plain failure";
    if (input.fail === "user") throw new UserError("Bad input");
    if (input.fail === "fix") throw new UserError("Bad input", "Do this instead");
    opts.onProgress?.({ message: "half", done: 1, total: 2 });
    opts.onProgress?.({ message: "no total" });
    opts.onProgress?.({ message: "zero", total: 3 });
    opts.onLog?.("warn", "careful");
    opts.onClaude?.({ type: "text", text: "said " });
    opts.onClaude?.({ type: "tool", name: "x", input: "{}" });
    const { done } = startJob("fake", "s", null, async (ctx) => {
      ctx.progress({ message: "job step", done: 1, total: 4 });
      ctx.progress({ message: "job plain" });
      ctx.progress({ message: "job zero", total: 2 });
      ctx.log("info", "job log");
      ctx.claude({ type: "text", text: "job text " });
      ctx.claude({ type: "tool", name: "t", input: "" });
      return null;
    });
    await done;
    if ("result" in input) return input.result;
    return { name, input, project: opts.project };
  };
  const describeCommand = (c: (typeof registry)[number]) =>
    c.name === "other.plain" && process.env.COV_CLI_RAW === "1"
      ? { ...actual.describe(c), input: undefined }
      : actual.describe(c);
  return { ...actual, registry, find, invoke, describe: describeCommand };
}

async function run(argv: string[], opts: { fake?: boolean; until?: () => boolean } = {}) {
  vi.resetModules();
  await freshEnv();
  if (opts.fake !== false) {
    const fake = await fakeRegistry();
    vi.doMock("../../../src/core/commands/index.ts", () => fake);
  }
  process.argv = [process.execPath, "cli.ts", ...argv];
  process.exitCode = undefined;
  out = "";
  err = "";
  await import("../../../src/faces/cli.ts");
  await vi.waitFor(
    () => {
      const ok = opts.until ? opts.until() : process.exitCode !== undefined;
      if (!ok) throw new Error("still running");
    },
    { timeout: 15000, interval: 10 },
  );
  const code = process.exitCode;
  process.exitCode = undefined;
  return { code, out, err };
}

const argvBefore = process.argv;

beforeEach(() => {
  exitCalls = [];
  sigint = process.listeners("SIGINT") as typeof sigint;
  vi.spyOn(process.stdout, "write").mockImplementation((s: string | Uint8Array) => {
    out += String(s);
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((s: string | Uint8Array) => {
    err += String(s);
    return true;
  });
  vi.spyOn(process, "exit").mockImplementation(((code: number) => {
    exitCalls.push(code);
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("../../../src/core/commands/index.ts");
  vi.doUnmock("../../../src/faces/http.ts");
  vi.doUnmock("../../../src/faces/mcp.ts");
  for (const l of process.listeners("SIGINT")) if (!sigint.includes(l as never)) process.off("SIGINT", l as never);
  process.argv = argvBefore;
  process.exitCode = undefined;
});

describe("CLI face", () => {
  it("prints the catalog for help, --help, -h and no argument", async () => {
    for (const argv of [[], ["help"], ["--help"], ["-h"]]) {
      const r = await run(argv);
      expect(r.code).toBe(0);
      expect(r.out).toContain("testimus <group> <verb>");
      expect(r.out).toContain("fake\n  bare  No object input.");
      expect(r.out).toContain("  run*  Echo the parsed input.");
      expect(r.out).toContain("other\n  plain  No positional.");
    }
  });

  it("prints one command's flags, required or optional, with its positional", async () => {
    const r = await run(["help", "fake.run"]);
    expect(r.out).toContain("fake.run * — Echo the parsed input.");
    expect(r.out).toContain("  --dry-run (optional)  Plan only");
    expect(r.out).toContain("  --flag (optional)  \n");
    expect(r.out).toContain("positional: name, list");
    const plain = await run(["help", "other.plain"]);
    expect(plain.out).toContain("other.plain — No positional.");
    expect(plain.out).toContain("  --id  Id");
    expect(plain.out).not.toContain("positional:");
    const bare = await run(["help", "fake.bare"]);
    expect(bare.out).toContain("fake.bare — No object input.");
    expect(bare.out).toContain("positional: ghost");
  });

  it("coerces flags by their schema type and prints JSON", async () => {
    const r = await run([
      "fake",
      "run",
      "--json",
      "--project",
      root,
      "--list",
      "a,b",
      "--list",
      '["c","d"]',
      "--count",
      "7",
      "--flag",
      "--dry-run=0",
      "--obj",
      '{"a":1}',
      "--rec",
      '{"k":"v"}',
      "--mode",
      "b",
      "--any",
      "42",
      "--loose=word",
      "--bare",
    ]);
    expect(r.code).toBe(0);
    const res = JSON.parse(r.out) as { name: string; input: Record<string, unknown>; project: string };
    expect(res.name).toBe("fake.run");
    expect(res.project).toBe(root);
    expect(res.input).toEqual({
      list: ["a", "b", "c", "d"],
      count: 7,
      flag: true,
      dryRun: false,
      obj: { a: 1 },
      rec: { k: "v" },
      mode: "b",
      any: 42,
      loose: "word",
      bare: true,
    });
    expect(r.err).toBe("");
  });

  it("keeps a non-JSON value of an untyped flag as a string and reads booleans", async () => {
    const r = await run(["fake.run", "--json", "--any", "not-json", "--flag=false", "--dryRun"]);
    const res = JSON.parse(r.out) as { input: Record<string, unknown> };
    expect(res.input).toMatchObject({ any: "not-json", flag: false, dryRun: true });
  });

  it("takes « --flag false » as the switch set to false, not as a positional", async () => {
    const r = await run(["fake.run", "--json", "alice", "--flag", "false", "--dry-run", "true"]);
    const res = JSON.parse(r.out) as { input: Record<string, unknown> };
    expect(res.input).toMatchObject({ name: "alice", flag: false, dryRun: true });
  });

  it("writes nested keys from dotted flags without JSON", async () => {
    const r = await run([
      "fake.run",
      "--json",
      "--name",
      "plain",
      "--name.x=1",
      "--deep.x=1",
      "--deep.x.y=hello",
      "--deep.x.z=[1,2]",
      "--deep.on=true",
      "--deep.off=null",
      '--deep.o={"k":2}',
      "--deep.neg=-1.5",
    ]);
    const res = JSON.parse(r.out) as { input: Record<string, unknown> };
    expect(res.input.name).toEqual({ x: 1 });
    expect(res.input.deep).toEqual({ x: { y: "hello", z: [1, 2] }, on: true, off: null, o: { k: 2 }, neg: -1.5 });
  });

  it("reads the numbers of a number list, and a dotted value by its own type", async () => {
    const r = await run(["fake.run", "--json", "--nums", "0,0.5", "--nums", "1"]);
    expect((JSON.parse(r.out) as { input: Record<string, unknown> }).input.nums).toEqual([0, 0.5, 1]);
    const d = await run([
      "fake.run",
      "--json",
      "--cfg.tag=1.10",
      "--cfg.on=false",
      "--cfg.names.RTU=[remote unit]",
      "--cfg.names.ID=007",
      "--deep.v=007",
    ]);
    expect(d.err).toBe("");
    const res = JSON.parse(d.out) as { input: Record<string, unknown> };
    expect(res.input.cfg).toEqual({ tag: "1.10", on: false, names: { RTU: "[remote unit]", ID: "007" } });
    expect(res.input.deep).toEqual({ v: "007" });
  });

  it("fills positionals, appending the extra ones to the last array", async () => {
    const r = await run(["fake", "run", "--json", "alice", "one", "two"]);
    const res = JSON.parse(r.out) as { input: Record<string, unknown> };
    expect(res.input).toMatchObject({ name: "alice", list: ["one", "two"] });
    const none = await run(["other", "plain", "--json", "--id", "x", "stray"]);
    expect((JSON.parse(none.out) as { input: unknown }).input).toEqual({ id: "x" });
    const ghost = await run(["fake", "bare", "--json", "12", "{bad"]);
    expect((JSON.parse(ghost.out) as { input: unknown }).input).toEqual({ ghost: "{bad" });
  });

  it("prints progress, logs and Claude text on stderr without --json", async () => {
    const r = await run(["fake", "run", "--result", "null"]);
    expect(r.code).toBe(0);
    expect(r.out).toBe("—\n");
    expect(r.err).toContain("[1/2] half\n");
    expect(r.err).toContain("no total\n");
    expect(r.err).toContain("[0/3] zero\n");
    expect(r.err).toContain("warn: careful\n");
    expect(r.err).toContain("said ");
    expect(r.err).toContain("[1/4] job step\n");
    expect(r.err, "a line moved past within the second is not printed").not.toContain("job plain\n");
    expect(r.err).toContain("[0/2] job zero\n");
    expect(r.err).toContain("info: job log\n");
    expect(r.err).toContain("job text ");
  });

  it("prints results for people", async () => {
    const result = {
      title: "T",
      none: null,
      tags: ["a", "b"],
      empty: [],
      nested: { k: 1 },
      checks: [
        { state: "fail", label: "Claude", detail: "missing", fix: "install it" },
        { state: "ok", label: "Jira", fix: "nothing" },
        { state: "warn", label: "Disk", detail: "low" },
        { other: 1 },
        [1, 2],
        "word",
        null,
      ],
    };
    const r = await run(["fake", "run", "--result", JSON.stringify(result)]);
    expect(r.out).toContain("title: T\n");
    expect(r.out).toContain("none: —\n");
    expect(r.out).toContain("tags: a, b\n");
    expect(r.out).toContain("empty: (none)\n");
    expect(r.out).toContain("nested:\n  k: 1\n");
    expect(r.out).toContain("  FAIL  Claude — missing\n        → install it\n");
    expect(r.out).toContain("  OK    Jira — \n");
    expect(r.out).toContain("  WARN  Disk — low\n");
    expect(r.out).toContain("  -\n    other: 1\n");
    expect(r.out).toContain("  - [1,2]\n");
    expect(r.out).toContain("  - word\n");
    expect(r.out).toContain("  - null");
    const list = await run(["fake", "run", "--result", "[]"]);
    expect(list.out).toBe("(none)\n");
    const scalar = await run(["fake", "run", "--result", "5"]);
    expect(scalar.out).toBe("5\n");
  });

  it("reports errors with their fix and exits 1", async () => {
    const unknown = await run(["nope", "verb"]);
    expect(unknown.code).toBe(1);
    expect(unknown.err).toBe("Unknown command nope.verb.\ntestimus help lists the commands.\n");
    const lone = await run(["nope"]);
    expect(lone.err).toContain("Unknown command nope..");
    const fix = await run(["fake", "run", "--fail", "fix"]);
    expect(fix.err).toContain("Bad input\nDo this instead\n");
    const user = await run(["fake", "run", "--fail", "user"]);
    expect(user.err).toContain("Bad input\n");
    expect(user.err).not.toContain("undefined");
    const plain = await run(["fake", "run", "--fail", "string"]);
    expect(plain.code).toBe(1);
    expect(plain.err).toContain("plain failure\n");
  });

  it("aborts the command on SIGINT", async () => {
    await run(["fake", "run", "--json"]);
    const added = process.listeners("SIGINT").filter((l) => !sigint.includes(l as never));
    expect(added.length).toBeGreaterThan(0);
    for (const l of added) (l as () => void)();
  });

  it("starts serve and leaves the process running", async () => {
    let args: string[] = [];
    vi.doMock("../../../src/faces/http.ts", () => ({
      serve: async (a: string[]) => {
        args = a;
      },
    }));
    const r = await run(["serve", "--port", "0", "--no-open"], { until: () => args.length > 0 });
    await new Promise((res) => setTimeout(res, 20));
    expect(args).toEqual(["--port", "0", "--no-open"]);
    expect(r.code).toBeUndefined();
    expect(exitCalls).toEqual([]);
  });

  it("exits 1 when serve cannot start", async () => {
    const { UserError } = await import("../../../src/core/command.ts");
    vi.doMock("../../../src/faces/http.ts", () => ({
      serve: async () => {
        throw new UserError("Port taken", "Pick another");
      },
    }));
    await run(["serve"], { until: () => exitCalls.length > 0 });
    expect(exitCalls).toEqual([1]);
    expect(err).toContain("Port taken");
  });

  it("starts the MCP server", async () => {
    let args: string[] | null = null;
    vi.doMock("../../../src/faces/mcp.ts", () => ({
      mcp: async (a: string[]) => {
        args = a;
      },
    }));
    await run(["mcp", "--project", root], { until: () => args !== null });
    expect(args).toEqual(["--project", root]);
  });

  it("prints a command whose schema has no description", async () => {
    process.env.COV_CLI_RAW = "1";
    try {
      const r = await run(["help", "other.plain"]);
      expect(r.out).toBe("other.plain — No positional.\n\n");
    } finally {
      delete process.env.COV_CLI_RAW;
    }
  });

  it("finishes even when stopping the model servers fails", async () => {
    vi.doMock("../../../src/core/rag/runtimes/llamacpp.ts", async (importOriginal) => ({
      ...(await importOriginal<object>()),
      stopAllServers: async () => {
        throw new Error("stuck");
      },
    }));
    try {
      const r = await run(["fake", "run", "--json"]);
      expect(r.code).toBe(0);
    } finally {
      vi.doUnmock("../../../src/core/rag/runtimes/llamacpp.ts");
    }
  });

  it("runs a real global command from the real registry", async () => {
    const r = await run(["system", "version", "--json"], { fake: false });
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toHaveProperty("version");
  });
});
