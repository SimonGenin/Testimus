import { describe, expect, it } from "vitest";
import { stageOf } from "../../../../src/core/lib/doc-stage.ts";
import { queueCopies } from "../../../../src/core/lib/docs-pending.ts";
import type { DocRef, Job, SourceType } from "../../../../src/core/types.ts";

const P = "D:/nowhere/project";
const at = "2026-11-12T10:00:00.000Z";

const doc = (id: string, type: SourceType, over: Partial<DocRef> = {}): DocRef => ({
  id,
  code: id,
  title: id,
  version: "",
  date: "",
  kind: "spec",
  status: "draft",
  source: {
    ...(type === "images" || type === "video" ? { type } : {}),
    name: `x.${type === "images" ? "jpg" : type === "video" ? "mp4" : type}`,
    file: type === "images" || type === "video" ? "files" : `source.${type}`,
    sha256: "",
  },
  converted: { with: "x", at, warnings: [] },
  indexed: "fresh",
  ...over,
});

const job = (step: string, over: Partial<Job> = {}): Job => ({
  id: "j",
  kind: "docs.convert",
  subject: "d",
  status: "running",
  startedAt: at,
  steps:
    step === "queue"
      ? [{ id: "queue", label: "", status: "running" }]
      : [
          { id: "queue", label: "", status: "done" },
          { id: step, label: "", status: "running" },
        ],
  ...over,
});

const none = { before: null };

describe("a document's stage", () => {
  it("is pending until started, copying while a start copies it, failed with the copy's reason", () => {
    const pending = { files: [{ path: "D:/x.docx", size: 300 }], pdf: { path: "D:/x.pdf", size: 200 }, at };
    const d = doc("p", "docx", { converted: undefined, indexed: "missing", pending });
    expect(stageOf(P, d, none)).toEqual({ name: "pending", bytes: 500 });
    const release = queueCopies(P, [d]);
    expect(stageOf(P, d, none)).toEqual({ name: "copying", step: "waiting", done: 0, total: 500 });
    release();
    const failed = { ...d, pending: { ...pending, failed: "D:/x.docx is no longer there." } };
    expect(stageOf(P, failed, none)).toEqual({
      name: "failed",
      step: "copy",
      message: "D:/x.docx is no longer there.",
    });
  });

  it("follows the conversion's step by type", () => {
    const word = doc("w", "docx");
    expect(stageOf(P, word, { ...none, running: job("queue") })).toEqual({ name: "converting", step: "waiting" });
    expect(stageOf(P, word, { ...none, running: job("convert", { progress: { done: 3, total: 12 } }) })).toEqual({
      name: "converting",
      step: "text",
      done: 3,
      total: 12,
      percent: 25,
    });
    expect(stageOf(P, word, { ...none, running: job("figures") }).step).toBe("figures");
    expect(stageOf(P, doc("f", "pdf"), { ...none, running: job("figures") }).step).toBe("figures");
    expect(stageOf(P, word, { ...none, running: job("cited") }).step).toBe("checking");
    expect(stageOf(P, word, { ...none, running: job("triage") }).step).toBe("checking");
    expect(stageOf(P, doc("t", "txt"), { ...none, running: job("convert") }).step).toBe("text");
    const photos = doc("i", "images");
    expect(stageOf(P, photos, { ...none, running: job("convert") }).step).toBe("pictures");
    expect(stageOf(P, photos, { ...none, running: job("read") }).step).toBe("pictures");
    const video = doc("v", "video");
    expect(
      stageOf(P, video, { ...none, running: job("convert", { message: "Transcribing manoeuvre.mp4 · 2 of 5" }) }).step,
    ).toBe("transcribing");
    expect(
      stageOf(P, video, { ...none, running: job("convert", { message: "Looking through manoeuvre.mp4" }) }).step,
    ).toBe("frames");
    expect(stageOf(P, video, { ...none, running: job("read") }).step).toBe("frames");
  });

  it("waits for the index, then is indexed", () => {
    const d = doc("w", "docx", { indexed: "missing" });
    expect(stageOf(P, d, { running: job("index"), before: 4 })).toEqual({ name: "waiting-index", before: 4 });
    expect(stageOf(P, d, { running: job("index"), before: null })).toEqual({ name: "waiting-index" });
    const read = { ...d, indexing: { state: "running" as const, percent: 40, done: 4, total: 10 } };
    expect(stageOf(P, read, { running: job("index"), before: 4 })).toEqual({
      name: "indexing",
      percent: 40,
      done: 4,
      total: 10,
    });
    expect(stageOf(P, { ...d, indexing: { state: "waiting", percent: 0, done: 0, total: 0 } }, none)).toEqual({
      name: "waiting-index",
    });
  });

  it("at rest: ready, stale, not indexed, not converted, or failed with the step", () => {
    expect(stageOf(P, doc("a", "docx"), none)).toEqual({ name: "ready" });
    expect(stageOf(P, doc("a", "docx", { indexed: "stale" }), none)).toEqual({ name: "stale" });
    expect(stageOf(P, doc("a", "docx", { indexed: "missing" }), none)).toEqual({ name: "not-indexed" });
    const raw = doc("a", "docx", { converted: undefined, indexed: "missing" });
    expect(stageOf(P, raw, none)).toEqual({ name: "not-converted" });
    const failed = job("convert", { status: "failed", error: "The .docx is damaged." });
    expect(stageOf(P, raw, { ...none, lastConvert: failed })).toEqual({
      name: "failed",
      step: "convert",
      message: "The .docx is damaged.",
    });
    expect(stageOf(P, raw, { ...none, lastConvert: { ...failed, status: "cancelled" } })).toEqual({
      name: "not-converted",
    });
    const index = job("index", {
      kind: "rag-index",
      status: "failed",
      error: "No room.",
      startedAt: "2026-11-12T11:00:00Z",
    });
    expect(stageOf(P, doc("a", "docx", { indexed: "missing" }), { ...none, lastIndex: index })).toEqual({
      name: "failed",
      step: "index",
      message: "No room.",
    });
    expect(
      stageOf(P, doc("a", "docx", { indexed: "missing" }), {
        ...none,
        lastIndex: { ...index, startedAt: "2026-11-11T00:00:00Z" },
      }),
    ).toEqual({
      name: "not-indexed",
    });
  });
});
