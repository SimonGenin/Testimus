import { cpSync, mkdtempSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Command } from "../../src/core/command.ts";

export const FIXTURE = join(import.meta.dirname, "..", "fixtures", "project");

export function tempRoot(tag: string): string {
  return mkdtempSync(join(tmpdir(), `testimus-cov-${tag}-`));
}

export function copyFixture(root: string, name = "p"): string {
  const dir = join(root, name);
  cpSync(FIXTURE, dir, { recursive: true });
  return dir;
}

export async function freshEnv(root: string) {
  const { env } = await import("../../src/core/env.ts");
  env.dataDir = () => join(root, "appdata");
  env.localDir = () => join(root, "localappdata");
  env.homeDir = () => join(root, "home");
  env.http = async (req) => {
    throw new Error(`Unit tests never reach the network: ${req.method} ${req.url}`);
  };
  env.spawnClaude = async () => {
    throw new Error("Unit tests never run claude");
  };
  return env;
}

export type Seen = { aborted: boolean; started: boolean };

export async function fakeCommands(seen: Seen) {
  const { command } = await import("../../src/core/command.ts");
  const none = z.object({});
  return [
    command({
      name: "fake.boom",
      summary: "Throws an Error.",
      input: none,
      output: z.unknown(),
      mutates: false,
      global: true,
      async run() {
        throw new Error("boom");
      },
    }),
    command({
      name: "fake.str",
      summary: "Throws a string.",
      input: none,
      output: z.unknown(),
      mutates: false,
      global: true,
      async run() {
        throw "plain text";
      },
    }),
    command({
      name: "fake.void",
      summary: "Returns nothing.",
      input: z.object({ x: z.number().optional().describe("x") }),
      output: z.unknown(),
      mutates: false,
      global: true,
      async run() {
        return undefined;
      },
    }),
    command({
      name: "fake.slow",
      summary: "Waits for its signal.",
      input: none,
      output: z.unknown(),
      mutates: false,
      global: true,
      async run(ctx) {
        seen.started = true;
        await new Promise<void>((r) => {
          if (ctx.signal.aborted) r();
          ctx.signal.addEventListener("abort", () => r(), { once: true });
        });
        seen.aborted = ctx.signal.aborted;
        return null;
      },
    }),
    command({
      name: "fake.job",
      summary: "A job.",
      input: z.object({ fail: z.string().optional().describe("Fail with this") }),
      output: z.unknown(),
      mutates: false,
      global: true,
      job: "fake",
      async run(ctx, input) {
        ctx.progress({ message: "working", done: 1, total: 2 });
        await new Promise((r) => setTimeout(r, 5));
        ctx.progress({ message: "later" });
        ctx.progress({ message: "counted", total: 3 });
        ctx.log("info", "not progress");
        if (input.fail) throw new Error(input.fail);
        return { ok: true };
      },
    }),
  ];
}

export async function withFakes(seen: Seen) {
  const actual = await import("../../src/core/commands/index.ts");
  const extra = await fakeCommands(seen);
  const registry = [...actual.registry, ...extra];
  const { UserError } = await import("../../src/core/command.ts");
  const find = (name: string) => {
    const c = registry.find((x) => x.name === name);
    if (!c) throw new UserError(`Unknown command ${name}.`, "testimus help lists the commands.");
    return c;
  };
  const { startJob } = await import("../../src/core/jobs.ts");
  const invoke = async (
    name: string,
    raw: unknown,
    opts: { project: string | null; signal?: AbortSignal; wait?: boolean },
  ) => {
    const c = find(name);
    if (!(extra as Command[]).includes(c)) return actual.invoke(name, raw, opts);
    const input = actual.parseInput(c, raw);
    if (c.job) {
      const { job, done } = startJob(c.job, "s", opts.project, (ctx) => c.run(ctx, input as never), opts.signal);
      if (opts.wait === false) return { jobId: job.id };
      return await done;
    }
    const { quietCtx } = await import("../../src/core/command.ts");
    return c.run(quietCtx(opts.project, opts.signal), input as never);
  };
  return { ...actual, registry, find, invoke };
}

export function rawRequest(
  port: number,
  path: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; host?: string } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((done, fail) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: opts.method ?? "GET",
        headers: { host: opts.host ?? `127.0.0.1:${port}`, ...opts.headers },
        setHost: false,
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8").on("data", (d: string) => (text += d));
        res.on("end", () => done({ status: res.statusCode ?? 0, headers: res.headers, text }));
      },
    );
    req.on("error", fail);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}
