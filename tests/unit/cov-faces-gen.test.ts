import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { quietCtx } from "../../src/core/command.ts";
import { commands } from "../../src/core/commands/gen.ts";
import { copyFixture, tempRoot } from "./cov-faces-helpers.ts";

const seen = vi.hoisted(() => ({ requests: [] as string[] }));

vi.mock("../../src/core/claude/generate.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generateTests: async (_project: string, input: { request: string }) => {
    seen.requests.push(input.request);
    return { ok: true, summary: "", tests: [], gaps: [], durationMs: 1 };
  },
}));

vi.mock("../../src/core/claude/figures.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  describeFigures: async (_project: string, docId: string) => ({
    docId,
    figures: 1,
    described: 1,
    missing: [],
    runIds: [],
    costUsd: 0,
  }),
}));

const cmd = (name: string) => {
  const c = commands.find((x) => x.name === name);
  if (!c) throw new Error(`no ${name}`);
  return c;
};
const subject = (name: string, raw: unknown) => cmd(name).subject?.(cmd(name).input.parse(raw) as never);

describe("gen subjects", () => {
  it("names a generation after its request, or its ids and sections, cut at 80 characters", () => {
    expect(subject("gen.tests", { request: " Sectionneurs " })).toBe("Sectionneurs");
    expect(
      subject("gen.tests", {
        requirements: ["R1"],
        tracked: [{ trace: "alarm", ids: ["A1", "A2"] }],
        sections: ["D#§1"],
      }),
    ).toBe("R1, A1, A2, D#§1");
    expect(subject("gen.tests", {})).toBe("");
    const long = subject("gen.tests", { request: "x".repeat(90) }) ?? "";
    expect(long).toHaveLength(80);
    expect(long.endsWith("...")).toBe(true);
    expect(subject("docs.describeFigures", {})).toBe("all documents");
    expect(subject("docs.describeFigures", { docId: "D" })).toBe("D");
  });
});

describe("docs.describeFigures", () => {
  it("describes nothing when there is no docs folder or the job is cancelled", async () => {
    const project = copyFixture(tempRoot("gen"));
    const c = cmd("docs.describeFigures");
    const ctrl = new AbortController();
    ctrl.abort();
    expect(await c.run(quietCtx(project, ctrl.signal), c.input.parse({}) as never)).toEqual({ docs: [] });
    const one = await c.run(quietCtx(project), c.input.parse({ docId: "SOSIE_211_D401-1_3" }) as never);
    expect(one).toMatchObject({ docs: [{ docId: "SOSIE_211_D401-1_3", described: 1 }] });
    rmSync(join(project, "docs"), { recursive: true });
    expect(await c.run(quietCtx(project), c.input.parse({}) as never)).toEqual({ docs: [] });
  });
});

describe("gen.tests request", () => {
  const runGen = async (project: string, raw: unknown) => {
    const c = cmd("gen.tests");
    await c.run(quietCtx(project), c.input.parse(raw) as never);
    return seen.requests.at(-1);
  };

  it("says the tracked ids to cover by their label, keeping only the kinds with ids", async () => {
    const project = copyFixture(tempRoot("gen"));
    expect(
      await runGen(project, {
        request: " Menus ",
        tracked: [
          { trace: "requirement", ids: ["R1", "R2"] },
          { trace: "uc", ids: [] },
          { trace: "other", ids: ["X"] },
        ],
      }),
    ).toBe(
      [
        "Menus",
        "Requirement ids to cover, each by at least one step: R1, R2",
        "other ids to cover, each by at least one step: X",
      ].join("\n"),
    );
    expect(await runGen(project, { tracked: [{ trace: "requirement", ids: ["R1"] }] })).toBe(
      ["(none in words)", "Requirement ids to cover, each by at least one step: R1"].join("\n"),
    );
  });

  it("passes the request as it is when no id is handed", async () => {
    const project = copyFixture(tempRoot("gen"));
    expect(await runGen(project, { tracked: [{ trace: "uc", ids: [] }] })).toBe("");
    expect(await runGen(project, { request: "Menus", docs: ["SOSIE_211_D401-1_3"] })).toBe("Menus");
  });
});
