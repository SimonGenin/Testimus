// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef, JobEvent } from "../../src/core/types.ts";

const runs: { name: string; input: Record<string, unknown> }[] = [];
let handlers: Record<string, (input: Record<string, unknown>, onEvent?: (e: JobEvent) => void) => unknown> = {};

vi.mock("../../src/ui/api.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/ui/api.ts")>();
  return {
    ...real,
    run: vi.fn(async (name: string, input: Record<string, unknown>, onEvent?: (e: JobEvent) => void) => {
      runs.push({ name, input });
      const h = handlers[name];
      if (!h) throw new Error(`no handler ${name}`);
      return await h(input, onEvent);
    }),
  };
});

const toasts: unknown[] = [];
vi.mock("../../src/ui/lib/toast.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/ui/lib/toast.ts")>();
  return { ...real, toast: vi.fn((t: unknown) => toasts.push(t)) };
});

const {
  addDocFiles,
  addDocPath,
  addDocPaths,
  dismissUpload,
  forgetSettled,
  importClaude,
  owns,
  readBase64,
  reindexAll,
  setImportClaude,
  settled,
  useUploads,
} = await import("../../src/ui/lib/uploads.ts");

const progress = (message: string, done?: number, total?: number): JobEvent => ({
  jobId: "j",
  at: "",
  type: "progress",
  message,
  done,
  total,
});

const current = () => renderHook(() => useUploads());

beforeEach(() => {
  runs.length = 0;
  toasts.length = 0;
  handlers = {
    "docs.add": (input, on) => {
      on?.({ jobId: "j", at: "", type: "log", level: "info", message: "ignored" });
      on?.(progress("Converting page 1", 1, 4));
      on?.(progress("Converting", undefined, 0));
      return { id: String(input.name ?? input.file) };
    },
    "rag.index": (_input, on) => {
      on?.(progress("Embedding", undefined, 2));
      return { chunks: 1 };
    },
  };
  act(() => forgetSettled());
});

afterEach(() => {
  vi.useRealTimers();
  delete window.testimusDesktop;
});

describe("uploads", () => {
  it("rejects what is not Word or PDF and converts then indexes the rest from base64", async () => {
    const h = current();
    const onDone = vi.fn();
    await act(() => addDocFiles([new File(["x"], "notes.txt"), new File(["PK"], "A.docx")], onDone));
    expect(toasts[0]).toMatchObject({ kind: "error", detail: "notes.txt" });
    expect(runs.map((r) => r.name)).toEqual(["docs.add", "rag.index"]);
    expect(runs[0].input).toEqual({ name: "A.docx", dataBase64: "UEs=" });
    expect(onDone).toHaveBeenCalledTimes(2);
    const row = h.result.current.find((u) => u.name === "A.docx");
    expect(row).toMatchObject({ phase: "done", message: "Indexed", pct: 100, docId: "A.docx" });
    expect(settled(row as never)).toBe(true);
  });

  it("pairs a Word file with the PDF of the same name, both by path", async () => {
    window.testimusDesktop = { pathOf: (f: File) => `C:\\d\\${f.name}` } as never;
    await act(() => addDocFiles([new File(["%"], "spec.PDF"), new File(["PK"], "Spec.docx")], () => {}));
    expect(runs.filter((r) => r.name === "docs.add").map((r) => r.input)).toEqual([
      { file: "C:\\d\\Spec.docx", pdf: "C:\\d\\spec.PDF" },
    ]);
  });

  it("sends the Claude model and effort picked for imports to the conversion and the index run", async () => {
    setImportClaude({ model: "sonnet", effort: "medium" });
    try {
      expect(importClaude()).toEqual({ model: "sonnet", effort: "medium" });
      await act(() => addDocPaths(["C:\\d\\Only.pdf"], () => {}));
      expect(runs).toEqual([
        { name: "docs.add", input: { file: "C:\\d\\Only.pdf", model: "sonnet", effort: "medium" } },
        { name: "rag.index", input: { model: "sonnet", effort: "medium" } },
      ]);
    } finally {
      setImportClaude({});
    }
  });

  it("sends a PDF picked alone, by path", async () => {
    await act(() => addDocPaths(["C:\\d\\Only.pdf", "C:\\d\\other.png"], () => {}));
    expect(runs[0]).toEqual({ name: "docs.add", input: { file: "C:\\d\\Only.pdf" } });
  });

  it("marks a row failed when conversion fails", async () => {
    handlers["docs.add"] = () => {
      throw new Error("not a docx");
    };
    const h = current();
    const onDone = vi.fn();
    await act(() => addDocPath("C:/d/Broken.docx", onDone));
    expect(h.result.current.find((u) => u.name === "Broken.docx")).toMatchObject({
      phase: "failed",
      message: "not a docx",
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(runs.map((r) => r.name)).toEqual(["docs.add"]);
  });

  it("names a path without separators by itself", async () => {
    const h = current();
    await act(() => addDocPath("Plain.docx", () => {}));
    expect(h.result.current.some((u) => u.name === "Plain.docx")).toBe(true);
  });

  it("marks a row index-failed when indexing fails", async () => {
    handlers["rag.index"] = () => {
      throw new Error("model missing");
    };
    const h = current();
    await act(() => addDocPath("C:\\d\\B.docx", () => {}));
    expect(h.result.current.find((u) => u.name === "B.docx")).toMatchObject({
      phase: "index-failed",
      message: "model missing",
    });
  });

  it("marks a row failed when the file cannot be read", async () => {
    vi.stubGlobal(
      "FileReader",
      class {
        error = null;
        onerror: (() => void) | null = null;
        readAsDataURL() {
          setTimeout(() => this.onerror?.(), 0);
        }
      },
    );
    const h = current();
    await act(() => addDocFiles([new File(["x"], "C.docx")], () => {}));
    vi.unstubAllGlobals();
    expect(h.result.current.find((u) => u.name === "C.docx")).toMatchObject({
      phase: "failed",
      message: "The file could not be read.",
    });
  });

  it("shares one index run between drops made together", async () => {
    let release: () => void = () => {};
    handlers["rag.index"] = () => new Promise<void>((r) => (release = r));
    const both = Promise.all([addDocPath("C:\\d\\E.docx", () => {}), addDocPath("C:\\d\\F.docx", () => {})]);
    await vi.waitFor(() => expect(runs.filter((r) => r.name === "rag.index")).toHaveLength(1));
    await act(async () => {
      release();
      await both;
    });
    expect(runs.filter((r) => r.name === "rag.index")).toHaveLength(1);
  });

  it("reindexes everything and forgets the row after a while", async () => {
    vi.useFakeTimers();
    const h = current();
    const onDone = vi.fn();
    await act(() => reindexAll(onDone));
    expect(onDone).toHaveBeenCalled();
    expect(h.result.current.find((u) => u.name === "All documents")).toMatchObject({ phase: "done", pct: 100 });
    act(() => vi.advanceTimersByTime(4000));
    expect(h.result.current.some((u) => u.name === "All documents")).toBe(false);
  });

  it("reports a failed reindex", async () => {
    handlers["rag.index"] = () => {
      throw new Error("busy");
    };
    const h = current();
    const onDone = vi.fn();
    await act(() => reindexAll(onDone));
    expect(onDone).toHaveBeenCalled();
    expect(h.result.current.find((u) => u.name === "All documents")).toMatchObject({ phase: "index-failed" });
  });

  it("dismisses one row and forgets settled rows only when there are some", async () => {
    let release: () => void = () => {};
    handlers["docs.add"] = () => new Promise((r) => (release = () => r({ id: "G" })));
    const h = current();
    const pending = addDocPath("C:\\d\\G.docx", () => {});
    await vi.waitFor(() => expect(h.result.current.some((u) => u.name === "G.docx")).toBe(true));
    const before = h.result.current;
    act(() => forgetSettled());
    expect(h.result.current).toBe(before);
    const key = h.result.current[0].key;
    act(() => dismissUpload(key));
    expect(h.result.current).toEqual([]);
    await act(async () => {
      release();
      await pending;
    });
  });

  it("ties a listed document to the upload still adding it", () => {
    const u = { key: 1, name: "Spec (3).docx", at: 1000, phase: "converting" as const, pct: null, message: "" };
    const d = (path: string, convertedAt: string, id = "SPEC_3_") =>
      ({ id, source: { path, sha256: "", file: "source.docx" }, convertedAt }) as DocRef;
    const later = new Date(2000).toISOString();
    expect(owns(u, d("C:\\in\\spec (3).DOCX", later))).toBe(true);
    expect(owns(u, d("upload: Spec (3).docx", later))).toBe(true);
    expect(owns(u, d("C:\\in\\Spec (3).docx", new Date(500).toISOString()))).toBe(false);
    expect(owns(u, d("C:\\in\\Other.docx", later))).toBe(false);
    expect(owns(u, d("C:\\in\\Spec (3).docx", ""))).toBe(false);
    expect(owns({ ...u, docId: "SPEC_3_" }, d("C:\\elsewhere.docx", ""))).toBe(true);
    expect(owns({ ...u, docId: "SPEC_3_" }, d("C:\\in\\Spec (3).docx", later, "OTHER"))).toBe(false);
    expect(owns({ ...u, phase: "failed" }, d("C:\\in\\Spec (3).docx", later))).toBe(false);
  });

  it("reads base64 and fails with a default message", async () => {
    expect(await readBase64(new Blob(["ok"]))).toBe("b2s=");
  });
});
