import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { freshEnv, tempRoot } from "./cov-faces-helpers.ts";

const root = tempRoot("registry");
let index: typeof import("../../src/core/commands/index.ts");

beforeAll(async () => {
  vi.resetModules();
  await freshEnv(root);
  vi.doMock("../../src/core/commands/chat.ts", async () => {
    const { command } = await import("../../src/core/command.ts");
    return {
      commands: [
        command({
          name: "fake.subjectless",
          summary: "A job without a subject.",
          input: z.object({ text: z.string().default("").describe("Text") }),
          output: z.unknown(),
          mutates: false,
          global: true,
          job: "fake",
          async run(_ctx, input) {
            return input.text;
          },
        }),
        command({
          name: "fake.talk",
          summary: "Reports through its context.",
          input: z.object({}),
          output: z.unknown(),
          mutates: false,
          global: true,
          async run(ctx) {
            ctx.progress({ message: "p" });
            ctx.log("info", "l");
            ctx.claude({ type: "text", text: "c" });
            return ctx.signal.aborted;
          },
        }),
      ],
    };
  });
  index = await import("../../src/core/commands/index.ts");
});

afterAll(() => {
  vi.doUnmock("../../src/core/commands/chat.ts");
});

describe("registry", () => {
  it("names a job without a subject after its input, cut at 80 characters", async () => {
    const { listJobs } = await import("../../src/core/jobs.ts");
    expect(await index.invoke("fake.subjectless", { text: "short" }, { project: null })).toBe("short");
    const long = "x".repeat(100);
    const r = (await index.invoke("fake.subjectless", { text: long }, { project: null, wait: false })) as {
      jobId: string;
    };
    const subjects = listJobs(null).map((j) => j.subject);
    expect(subjects).toContain('{"text":"short"}');
    const cut = listJobs(null).find((j) => j.id === r.jobId)?.subject ?? "";
    expect(cut).toHaveLength(80);
    expect(cut.endsWith("...")).toBe(true);
  });

  it("hands progress, logs and Claude events to the caller, or drops them", async () => {
    const seen: string[] = [];
    const out = await index.invoke(
      "fake.talk",
      {},
      {
        project: null,
        onProgress: (p) => seen.push(p.message),
        onLog: (_l, m) => seen.push(m),
        onClaude: (e) => seen.push(e.type),
      },
    );
    expect(out).toBe(false);
    expect(seen).toEqual(["p", "l", "text"]);
    expect(await index.invoke("fake.talk", undefined, { project: null })).toBe(false);
  });

  it("explains an input that is not an object, and an unknown command", async () => {
    await expect(index.invoke("fake.talk", "text", { project: null })).rejects.toThrow(
      /^Invalid input for fake\.talk — input: /,
    );
    await expect(index.invoke("fake.nothing", {}, { project: null })).rejects.toThrow("Unknown command fake.nothing.");
    await expect(index.invoke("jobs.list", {}, { project: null })).rejects.toThrow("No project is open.");
  });
});
