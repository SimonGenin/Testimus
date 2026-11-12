import { existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { invoke } from "../../../../src/core/commands/index.ts";
import { listJobs, waitJob } from "../../../../src/core/jobs.ts";
import { readDoc, writeDoc } from "../../../../src/core/lib/docs.ts";
import { videoIo } from "../../../../src/core/lib/video/io.ts";
import type { DocStage } from "../../../../src/core/types.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";
import { taggedPdf } from "../../../fixtures/pdf/tagged.ts";
import { call, fixtureCopy } from "../registry.ts";

const realProbe = videoIo.probe;
afterEach(() => {
  videoIo.probe = realProbe;
});

type Listed = { id: string; stage: DocStage; pending?: { files: { path: string; size: number }[]; failed?: string } };
type Added = { added: { id: string; pending?: unknown; source: { file: string } }[]; converted: unknown[] };

const jpg = async (g: number) =>
  (await import("sharp"))
    .default({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g, b: 10 } } })
    .jpeg()
    .toBuffer();

// ponytail: a client's folder — two Word documents (one with its .pdf), a PDF, a text, the photos of a visit, a video
async function clientFolder(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "testimus-client-"));
  writeFileSync(join(dir, "SPEC_A_01_00.docx"), sampleDocx());
  writeFileSync(join(dir, "SPEC_A_01_00.pdf"), taggedPdf());
  writeFileSync(join(dir, "SPEC_B_01_00.docx"), sampleDocx());
  writeFileSync(join(dir, "SPEC_C_01_00.pdf"), taggedPdf());
  writeFileSync(join(dir, "Notes.txt"), "Le régulateur acquitte l'alarme.");
  mkdirSync(join(dir, "Visite PCC"));
  writeFileSync(join(dir, "Visite PCC", "IMG_1.jpg"), await jpg(10));
  writeFileSync(join(dir, "Visite PCC", "IMG_2.jpg"), await jpg(200));
  writeFileSync(join(dir, "Essai.mp4"), JSON.stringify({ duration: 1500 }));
  return dir;
}

const fakeProbe = () => {
  videoIo.probe = async () => ({
    duration: 1500,
    picture: true,
    audio: true,
    tracks: [{}],
    hdr: false,
    bytes: 0,
  });
};

const stages = async (P: string) =>
  Object.fromEntries((await call<Listed[]>("docs.list", {}, P)).map((d) => [d.id, d.stage]));

describe("docs.addFolder with start false", () => {
  it("adds the documents waiting to start: their doc.json only, nothing copied, no conversion", async () => {
    fakeProbe();
    const P = fixtureCopy("pending-add");
    const dir = await clientFolder();
    const r = await call<Added>("docs.addFolder", { dir, start: false }, P);
    const ids = r.added.map((d) => d.id).sort();
    expect(ids).toEqual(["Essai", "Notes", "SPEC_A", "SPEC_B", "SPEC_C", "Visite_PCC"]);
    expect(r.converted).toEqual([]);
    for (const id of ids) {
      expect(readdirSync(join(P, "docs", id))).toEqual(["doc.json"]);
      expect(readDoc(P, id).pending?.files.length).toBeGreaterThan(0);
    }
    const a = readDoc(P, "SPEC_A");
    expect(a.pending?.files[0]).toMatchObject({ path: join(dir, "SPEC_A_01_00.docx"), size: sampleDocx().length });
    expect(a.pending?.pdf).toMatchObject({ path: join(dir, "SPEC_A_01_00.pdf"), size: taggedPdf().length });
    expect(readDoc(P, "Essai").pending?.files[0]).toMatchObject({ duration: 1500, audio: true, tracks: 1 });
    expect(readDoc(P, "Visite_PCC")).toMatchObject({ title: "Visite PCC", source: { type: "images" } });
    expect(listJobs(P).filter((j) => j.kind === "docs.convert")).toEqual([]);
    const s = await stages(P);
    expect(s.SPEC_A).toEqual({ name: "pending", bytes: sampleDocx().length + taggedPdf().length });
    expect(s.Visite_PCC.name).toBe("pending");
    expect(s["SOSIE_211_D401-1_3"].name).not.toBe("pending");
  });

  it("plans the start: documents by type, bytes, room, Claude's runs and a duration", async () => {
    fakeProbe();
    const P = fixtureCopy("pending-plan");
    const dir = await clientFolder();
    await call("docs.addFolder", { dir, start: false }, P);
    const plan = await call<{
      ids: string[];
      byType: Record<string, number>;
      files: number;
      bytes: number;
      freeBytes: number | null;
      short: boolean;
      claudeRuns: number;
      seconds: number;
      copySeconds: number;
      convertSeconds: number;
    }>("docs.planStart", {}, P);
    expect(plan.ids).toHaveLength(6);
    expect(plan.byType).toEqual({ docx: 2, pdf: 1, txt: 1, images: 1, video: 1, mixed: 0 });
    expect(plan.files).toBe(8);
    expect(plan.bytes).toBeGreaterThan(sampleDocx().length * 2);
    expect(plan.short).toBe(false);
    expect(plan.claudeRuns).toBe(3 + 1 + 12);
    expect(plan.convertSeconds).toBeGreaterThanOrEqual(Math.round(1500 * 0.24));
    expect(plan.seconds).toBe(plan.copySeconds + plan.convertSeconds);
    const one = await call<{ ids: string[]; byType: Record<string, number> }>("docs.planStart", { ids: ["Notes"] }, P);
    expect(one).toMatchObject({ ids: ["Notes"], byType: { txt: 1, docx: 0 } });
  });

  it("refuses to start what the project's drive has no room for", async () => {
    const P = fixtureCopy("pending-room");
    const dir = await clientFolder();
    await call("docs.addFolder", { dir, start: false, files: ["Notes.txt"] }, P);
    const d = readDoc(P, "Notes");
    writeDoc(P, {
      ...d,
      pending: {
        ...(d.pending as NonNullable<typeof d.pending>),
        files: [{ path: join(dir, "Notes.txt"), size: 1e18 }],
      },
    });
    expect((await call<{ short: boolean }>("docs.planStart", {}, P)).short).toBe(true);
    await expect(call("docs.start", { ids: ["Notes"] }, P)).rejects.toThrow(/Not enough room/);
    expect(readDoc(P, "Notes").pending).toBeTruthy();
  });
});

describe("docs.start", () => {
  it("copies and converts the documents asked for; the others keep waiting", async () => {
    const P = fixtureCopy("pending-start");
    const dir = await clientFolder();
    await call("docs.addFolder", { dir, start: false, files: ["SPEC_A_01_00.docx", "SPEC_B_01_00.docx"] }, P);
    const r = await call<{
      started: { id: string; twin?: { file: string } }[];
      converted: { id: string; status: string }[];
    }>("docs.start", { ids: ["SPEC_A"], describeFigures: false }, P);
    expect(r.started.map((d) => [d.id, d.twin?.file])).toEqual([["SPEC_A", "source.pdf"]]);
    expect(r.converted.map((c) => [c.id, c.status])).toEqual([["SPEC_A", "done"]]);
    expect(readDoc(P, "SPEC_A").pending).toBeUndefined();
    expect(existsSync(join(P, "docs", "SPEC_A", "source.docx"))).toBe(true);
    const parent = listJobs(P).find((j) => j.kind === "docs.add" && j.subject === "SPEC_A");
    expect(
      listJobs(P)
        .filter((j) => j.kind === "docs.convert")
        .map((j) => [j.subject, j.parentId]),
    ).toEqual([["SPEC_A", parent?.id]]);
    const s = await stages(P);
    expect(s.SPEC_A).toEqual({ name: "ready" });
    expect(s.SPEC_B.name).toBe("pending");
  });

  it("starts every document waiting by default; with convert false they are only copied", async () => {
    const P = fixtureCopy("pending-all");
    const dir = await clientFolder();
    await call(
      "docs.addFolder",
      { dir, start: false, files: ["Notes.txt", "Visite PCC/IMG_1.jpg", "Visite PCC/IMG_2.jpg"] },
      P,
    );
    const r = await call<{ started: { id: string; source: { files?: unknown[] } }[] }>(
      "docs.start",
      { convert: false },
      P,
    );
    expect(r.started.map((d) => [d.id, d.source.files?.length ?? 0])).toEqual([
      ["Notes", 0],
      ["Visite_PCC", 2],
    ]);
    const s = await stages(P);
    expect([s.Notes, s.Visite_PCC]).toEqual([{ name: "not-converted" }, { name: "not-converted" }]);
    await expect(call("docs.start", {}, P)).rejects.toThrow(/No document is waiting to start/);
  });

  it("leaves a document whose original went pending with the reason; it starts once the file is back", async () => {
    const P = fixtureCopy("pending-gone");
    const dir = await clientFolder();
    await call("docs.addFolder", { dir, start: false, files: ["Notes.txt", "SPEC_B_01_00.docx"] }, P);
    renameSync(join(dir, "Notes.txt"), join(dir, "Notes.bak"));
    const r = await call<{ started: { id: string }[]; rejected: { name: string; code: string; why: string }[] }>(
      "docs.start",
      { convert: false },
      P,
    );
    expect(r.started.map((d) => d.id)).toEqual(["SPEC_B"]);
    expect(r.rejected).toEqual([{ name: "Notes.txt", code: "failed", why: expect.stringMatching(/no longer there/) }]);
    expect(readdirSync(join(P, "docs", "Notes"))).toEqual(["doc.json"]);
    expect((await stages(P)).Notes).toMatchObject({
      name: "failed",
      step: "copy",
      message: expect.stringMatching(/no longer there/),
    });
    renameSync(join(dir, "Notes.bak"), join(dir, "Notes.txt"));
    await call("docs.start", { ids: ["Notes"], convert: false }, P);
    expect((await stages(P)).Notes).toEqual({ name: "not-converted" });
  });

  it("says which documents asked for were not waiting", async () => {
    const P = fixtureCopy("pending-not");
    const dir = await clientFolder();
    await call("docs.addFolder", { dir, start: false, files: ["Notes.txt"] }, P);
    const r = await call<{ rejected: { name: string; code: string }[] }>(
      "docs.start",
      { ids: ["Notes", "SOSIE_211_D401-1_3", "NOPE"], convert: false },
      P,
    );
    expect(r.rejected.map((x) => [x.name, x.code])).toEqual([
      ["SOSIE_211_D401-1_3", "not-pending"],
      ["NOPE", "not-pending"],
    ]);
  });

  it("is a job that answers at once and copies in the background", async () => {
    const P = fixtureCopy("pending-job");
    const dir = await clientFolder();
    await call("docs.addFolder", { dir, start: false, files: ["Notes.txt"] }, P);
    const { jobId } = (await invoke("docs.start", { convert: false }, { project: P, wait: false })) as {
      jobId: string;
    };
    await waitJob(jobId);
    expect(existsSync(join(P, "docs", "Notes", "source.txt"))).toBe(true);
  });
});

describe("a pending document elsewhere", () => {
  it("is removed without a trace and never converted before it is started", async () => {
    const P = fixtureCopy("pending-remove");
    const dir = await clientFolder();
    await call("docs.addFolder", { dir, start: false, files: ["SPEC_B_01_00.docx"] }, P);
    await expect(call("docs.convert", { id: "SPEC_B" }, P)).rejects.toThrow(/waiting to start/);
    await call("docs.remove", { id: "SPEC_B" }, P);
    expect(existsSync(join(P, "docs", "SPEC_B"))).toBe(false);
    expect((await call<Listed[]>("docs.list", {}, P)).some((d) => d.id === "SPEC_B")).toBe(false);
    expect(existsSync(join(dir, "SPEC_B_01_00.docx"))).toBe(true);
  });

  it("a project written before pending existed reads as it did", async () => {
    const P = fixtureCopy("pending-old");
    const s = await stages(P);
    expect(Object.values(s).every((x) => x.name !== "pending" && x.name !== "copying")).toBe(true);
    expect(await call<{ ids: string[] }>("docs.planStart", {}, P)).toMatchObject({ ids: [], bytes: 0, claudeRuns: 0 });
  });
});
