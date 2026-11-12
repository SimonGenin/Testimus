import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { listJobs } from "../../../../src/core/jobs.ts";
import { queueIndex, whileConverting } from "../../../../src/core/lib/docs-index.ts";
import { pairFiles } from "../../../../src/core/lib/docs-pipeline.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";
import { taggedPdf } from "../../../fixtures/pdf/tagged.ts";
import { call, fixtureCopy } from "../registry.ts";

const real = env.spawnClaude;
afterEach(() => {
  env.spawnClaude = real;
  resetProbe();
});

type Doc = {
  id: string;
  source: { name: string; uploaded?: boolean };
  twin?: { file: string };
  converted?: { warnings: string[] };
  index?: { chunks?: number; degraded?: string; error?: string };
};

function client(P: string, name: string, data: Uint8Array | string): string {
  mkdirSync(join(P, "..", "client"), { recursive: true });
  const file = join(P, "..", "client", name);
  writeFileSync(file, data);
  return file;
}

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");

describe("pairing the files dropped together", () => {
  it("makes one document of a .docx and the .pdf of the same name, keeps a .pdf or a text file alone, refuses the rest", () => {
    const r = pairFiles([
      { path: "/c/notes.txt" },
      { path: "/c/budget.xlsx" },
      { name: "B.pdf", dataBase64: "x" },
      { path: "/c/A.PDF" },
      { path: "/c/a.docx" },
      { name: "nothing.docx" },
    ]);
    expect(r.docs).toEqual([
      { main: { path: "/c/a.docx" }, pdf: { path: "/c/A.PDF" } },
      { main: { name: "B.pdf", dataBase64: "x" } },
      { main: { path: "/c/notes.txt" } },
    ]);
    expect(r.rejected).toEqual([{ path: "/c/budget.xlsx" }, { name: "nothing.docx" }]);
  });
});

describe("docs.addFiles", () => {
  it("adds each document once, by path or by upload, paired, and says why the others were refused", async () => {
    const P = fixtureCopy("addfiles");
    const docx = client(P, "SPEC_PAIR_01.01.docx", sampleDocx());
    const pdf = client(P, "SPEC_PAIR_01.01.pdf", taggedPdf());
    const r = await call<{ added: Doc[]; rejected: { name: string; why: string }[] }>(
      "docs.addFiles",
      {
        files: [
          { path: pdf },
          { path: docx },
          { name: "UP_02.pdf", dataBase64: b64(taggedPdf()) },
          { path: client(P, "readme.txt", "x") },
          { path: client(P, "budget.xlsx", "x") },
          { path: client(P, "SOSIE_211_D401-1_3_01_01.docx", sampleDocx()) },
        ],
      },
      P,
    );
    expect(r.added.map((d) => [d.id, d.twin?.file ?? null, d.source.uploaded ?? false])).toEqual([
      ["SPEC_PAIR", "source.pdf", false],
      ["UP_02", null, true],
      ["readme", null, false],
    ]);
    expect(r.added.every((d) => d.converted === undefined)).toBe(true);
    expect(r.rejected).toEqual([
      {
        name: "budget.xlsx",
        why: "Only Word (.docx), PDF, text (.txt), image and video files can be added.",
        code: "not-a-document",
      },
      { name: "SOSIE_211_D401-1_3_01_01.docx", why: "Document SOSIE_211_D401-1_3 already exists.", code: "failed" },
    ]);
    expect(r.added[1].source.name).toBe("UP_02.pdf");
  });
});

describe("docs.convert with index and triage", () => {
  it("updates the search index in a child job of the conversion", async () => {
    const P = fixtureCopy("conv-index");
    await call("docs.add", { file: client(P, "IDX_01.pdf", taggedPdf({ outline: true })), convert: false }, P);
    const doc = await call<Doc>("docs.convert", { id: "IDX_01", index: true, describeFigures: false }, P);
    expect(doc.index?.chunks).toBeGreaterThan(0);
    expect(doc.index?.error).toBeUndefined();
    const jobs = listJobs(P);
    const conv = jobs.find((j) => j.kind === "docs.convert");
    const child = jobs.find((j) => j.kind === "rag-index");
    expect(child?.parentId).toBe(conv?.id);
    expect(child?.rerun).toEqual({ name: "rag.index", input: { force: false } });
    expect(conv?.steps?.find((s) => s.id === "index")).toMatchObject({ status: "done", jobId: child?.id });
    const listed = await call<{ id: string; indexed: string }[]>("docs.list", {}, P);
    expect(listed.find((d) => d.id === "IDX_01")?.indexed).toBe("fresh");
  });

  it("leaves the warnings alone when Claude is not installed, and asks Claude when it is", async () => {
    const P = fixtureCopy("conv-triage");
    await call("docs.add", { file: client(P, "TRI_01.pdf", taggedPdf()), convert: false }, P);
    const prompts: string[] = [];
    env.spawnClaude = async (s: ClaudeSpawn): Promise<ClaudeOut> => {
      if (s.args.includes("--version")) return { code: 1, stdout: "", stderr: "not found" };
      prompts.push(s.stdin);
      return { code: 0, stdout: "", stderr: "" };
    };
    const off = await call<Doc>("docs.convert", { id: "TRI_01", triage: true, describeFigures: false }, P);
    expect(off.converted?.warnings.length).toBeGreaterThan(0);
    expect(prompts).toEqual([]);
    resetProbe();
    env.spawnClaude = async (s: ClaudeSpawn): Promise<ClaudeOut> => {
      if (s.args.includes("--version")) return { code: 0, stdout: "2.1.0 (Claude Code)", stderr: "" };
      prompts.push(s.stdin);
      const l = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "ok", duration_ms: 5 });
      s.onLine?.(l);
      return { code: 0, stdout: `${l}\n`, stderr: "" };
    };
    await call<Doc>("docs.convert", { id: "TRI_01", triage: true, describeFigures: false }, P);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("TRI_01");
  });
});

describe("the index queue", () => {
  const later = () => {
    let open = () => {};
    const p = new Promise<void>((r) => {
      open = r;
    });
    return { p, open };
  };

  it("runs at once when no pass is running, never waits for a conversion, and shares a waiting pass", async () => {
    const P = fixtureCopy("queue");
    const order: string[] = [];
    expect(await queueIndex(P, async () => "now")).toBe("now");
    const conv = later();
    const converting = whileConverting(P, () => conv.p.then(() => order.push("converted")));
    expect(await queueIndex(P, async () => order.push("indexed"))).toBe(1);
    const first = later();
    const said: string[] = [];
    let runs = 0;
    const run = async () => {
      runs++;
      return runs;
    };
    const going = queueIndex(P, () => first.p.then(() => 0));
    const a = queueIndex(P, run, { waiting: (m) => said.push(m) });
    const b = queueIndex(P, run, { waiting: (m) => said.push(m) });
    first.open();
    expect(await going).toBe(0);
    expect(await a).toBe(1);
    expect(await b).toBe(1);
    expect(runs).toBe(1);
    conv.open();
    await converting;
    expect(order).toEqual(["indexed", "converted"]);
    expect(said).toEqual([
      "Waiting for the running index (5 documents before)",
      "Waiting for the running index (5 documents before)",
    ]);
  });

  it("three conversions ending at different times make two passes, the first before the third conversion ends", async () => {
    const P = fixtureCopy("queue-passes");
    const ends = [later(), later(), later()];
    const pass = [later(), later(), later()];
    const order: string[] = [];
    let n = 0;
    const index = () => {
      const k = n++;
      order.push(`pass ${k + 1}`);
      return pass[k].p.then(() => order.push(`pass ${k + 1} done`));
    };
    const conversions = ends.map((e, i) =>
      whileConverting(P, async () => {
        await e.p;
        order.push(`converted ${i + 1}`);
        return queueIndex(P, index);
      }),
    );
    ends[0].open();
    await new Promise((r) => setImmediate(r));
    expect(order).toEqual(["converted 1", "pass 1"]);
    ends[1].open();
    await new Promise((r) => setImmediate(r));
    ends[2].open();
    await new Promise((r) => setImmediate(r));
    pass[0].open();
    pass[1].open();
    await Promise.all(conversions);
    expect(order).toEqual([
      "converted 1",
      "pass 1",
      "converted 2",
      "converted 3",
      "pass 1 done",
      "pass 2",
      "pass 2 done",
    ]);
    expect(n).toBe(2);
  });

  it("waits for a run in progress, and a cancelled waiter stops waiting", async () => {
    const P = fixtureCopy("queue2");
    const first = later();
    const running = queueIndex(P, () => first.p.then(() => "first"));
    const said: string[] = [];
    const ctl = new AbortController();
    const cancelled = queueIndex(P, async () => "second", {
      signal: ctl.signal,
      waiting: (m) => said.push(m),
    });
    ctl.abort();
    await expect(cancelled).rejects.toThrow();
    expect(said).toEqual(["Waiting for the running index (5 documents before)"]);
    first.open();
    expect(await running).toBe("first");
  });

  it("never joins a run already started: the run asked for meanwhile follows it", async () => {
    const P = fixtureCopy("queue3");
    const first = later();
    const order: string[] = [];
    const running = queueIndex(P, () => first.p.then(() => order.push("first")));
    const next = queueIndex(P, async () => order.push("second"));
    expect(order).toEqual([]);
    first.open();
    await Promise.all([running, next]);
    expect(order).toEqual(["first", "second"]);
  });
});

describe("docs.show and docs.set: the context and the disk", () => {
  it("refuses a context saved over a context.md changed on disk since it was read", async () => {
    const P = fixtureCopy("ctx-mtime");
    const D = "SOSIE_211_D401-1_4";
    const shown = await call<{ contextMtime: number | null }>("docs.show", { id: D, brief: true }, P);
    expect(shown.contextMtime).toBeNull();
    const saved = await call<{ contextMtime: number }>("docs.set", { id: D, context: "Un", ifMtime: null }, P);
    expect(saved.contextMtime).toBeGreaterThan(0);
    await expect(call("docs.set", { id: D, context: "Deux", ifMtime: null }, P)).rejects.toMatchObject({
      code: "conflict",
    });
    const again = await call<{ contextMtime: number }>(
      "docs.set",
      { id: D, context: "Deux", ifMtime: saved.contextMtime },
      P,
    );
    expect(readFileSync(join(P, "docs", D, "context.md"), "utf8")).toBe("Deux\n");
    writeFileSync(join(P, "docs", D, "context.md"), "Changé à la main\n");
    const { utimesSync } = await import("node:fs");
    utimesSync(join(P, "docs", D, "context.md"), new Date(), new Date(Date.now() + 5000));
    await expect(call("docs.set", { id: D, context: "Trois", ifMtime: again.contextMtime }, P)).rejects.toMatchObject({
      code: "conflict",
      fix: expect.stringContaining("docs.show"),
    });
    expect(readFileSync(join(P, "docs", D, "context.md"), "utf8")).toBe("Changé à la main\n");
    await call("docs.set", { id: D, context: "Sans contrôle" }, P);
    expect(readFileSync(join(P, "docs", D, "context.md"), "utf8")).toBe("Sans contrôle\n");
  });
});
