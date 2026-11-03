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
  convertDoc,
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
    "docs.addFiles": (input, on) => {
      on?.({ jobId: "j", at: "", type: "log", level: "info", message: "ignored" });
      on?.(progress("Converting page 1", 1, 4));
      on?.(progress("Converting", undefined, 0));
      const files = input.files as { name?: string; path?: string }[];
      const name = (f: { name?: string; path?: string }) => f.name ?? String(f.path).split(/[\\/]/).pop() ?? "";
      const doc = (f: { name?: string; path?: string }) => /\.(docx|pdf)$/i.test(name(f));
      return {
        added: files.filter(doc).map((f) => ({ id: name(f) })),
        rejected: files
          .filter((f) => !doc(f))
          .map((f) => ({
            name: name(f),
            why: "Only Word (.docx) and PDF files can be added.",
            code: "not-a-document",
          })),
      };
    },
    "docs.convert": (input, on) => {
      on?.(progress("Converting page 1", 1, 4));
      return { id: input.id, converted: { with: "", at: "", warnings: [] } };
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
  it("rejects what is not Word or PDF and only copies the rest from base64, without converting", async () => {
    const h = current();
    const onDone = vi.fn();
    await act(() => addDocFiles([new File(["x"], "notes.txt"), new File(["PK"], "A.docx")], onDone));
    expect(toasts[0]).toMatchObject({ kind: "error", detail: "notes.txt" });
    expect(runs.map((r) => r.name)).toEqual(["docs.addFiles"]);
    expect(runs[0].input).toEqual({
      files: [
        { name: "notes.txt", dataBase64: "eA==" },
        { name: "A.docx", dataBase64: "UEs=" },
      ],
    });
    expect(onDone).toHaveBeenCalledExactlyOnceWith("A.docx");
    expect(h.result.current.some((u) => u.name === "A.docx" || u.name === "notes.txt")).toBe(false);
  });

  it("converts, triages and indexes a document in one job with the context of this job, and forgets the row after a while", async () => {
    vi.useFakeTimers();
    setImportClaude({ model: "sonnet", effort: "medium" });
    try {
      const h = current();
      const onDone = vi.fn();
      await act(() => convertDoc("A", "A.docx", { note: " the 2024 edition ", contexts: ["glossary"] }, onDone));
      expect(runs).toEqual([
        {
          name: "docs.convert",
          input: {
            id: "A",
            model: "sonnet",
            effort: "medium",
            note: "the 2024 edition",
            contexts: ["glossary"],
            triage: true,
            index: true,
          },
        },
      ]);
      expect(onDone).toHaveBeenCalledTimes(1);
      const row = h.result.current.find((u) => u.docId === "A");
      expect(row).toMatchObject({ job: "convert", phase: "done", message: "Converted and indexed", pct: 100 });
      expect(settled(row as never)).toBe(true);
      act(() => vi.advanceTimersByTime(4000));
      expect(h.result.current.some((u) => u.docId === "A")).toBe(false);
    } finally {
      setImportClaude({});
    }
  });

  it("marks a conversion failed and does not index", async () => {
    handlers["docs.convert"] = () => {
      throw new Error("not a docx");
    };
    const h = current();
    const onDone = vi.fn();
    await act(() => convertDoc("Broken", "Broken.docx", {}, onDone));
    expect(h.result.current.find((u) => u.docId === "Broken")).toMatchObject({
      phase: "failed",
      message: "not a docx",
    });
    expect(runs.map((r) => r.name)).toEqual(["docs.convert"]);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("sends a Word file and its PDF together, both by path, for the core to pair", async () => {
    window.testimusDesktop = { pathOf: (f: File) => `C:\\d\\${f.name}` } as never;
    await act(() => addDocFiles([new File(["%"], "spec.PDF"), new File(["PK"], "Spec.docx")], () => {}));
    expect(runs.filter((r) => r.name === "docs.addFiles").map((r) => r.input)).toEqual([
      { files: [{ path: "C:\\d\\spec.PDF" }, { path: "C:\\d\\Spec.docx" }] },
    ]);
  });

  it("keeps the Claude model and effort picked for conversions, and does not send them to the copy", async () => {
    setImportClaude({ model: "sonnet", effort: "medium" });
    try {
      expect(importClaude()).toEqual({ model: "sonnet", effort: "medium" });
      await act(() => addDocPaths(["C:\\d\\Only.pdf"], () => {}));
      expect(runs).toEqual([{ name: "docs.addFiles", input: { files: [{ path: "C:\\d\\Only.pdf" }] } }]);
    } finally {
      setImportClaude({});
    }
  });

  it("sends the files picked by path, and toasts what the core refused as not a document", async () => {
    const h = current();
    await act(() => addDocPaths(["C:\\d\\Only.pdf", "C:\\d\\other.png"], () => {}));
    expect(runs[0]).toEqual({
      name: "docs.addFiles",
      input: { files: [{ path: "C:\\d\\Only.pdf" }, { path: "C:\\d\\other.png" }] },
    });
    expect(toasts[0]).toMatchObject({ kind: "error", detail: "other.png" });
    expect(h.result.current.some((u) => u.name === "other.png")).toBe(false);
  });

  it("marks the row of a document the core could not copy failed, with its reason", async () => {
    handlers["docs.addFiles"] = () => ({
      added: [],
      rejected: [{ name: "Twice.docx", why: "Document TWICE already exists.", code: "failed" }],
    });
    const h = current();
    const onDone = vi.fn();
    await act(() => addDocPath("C:\\d\\Twice.docx", onDone));
    expect(h.result.current.find((u) => u.name === "Twice.docx")).toMatchObject({
      phase: "failed",
      message: "Document TWICE already exists.",
    });
    expect(toasts).toEqual([]);
    expect(onDone).toHaveBeenCalledExactlyOnceWith();
  });

  it("marks a row failed when the copy fails", async () => {
    handlers["docs.addFiles"] = () => {
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
    expect(runs.map((r) => r.name)).toEqual(["docs.addFiles"]);
  });

  it("names a path without separators by itself", async () => {
    handlers["docs.addFiles"] = () => {
      throw new Error("not found");
    };
    const h = current();
    await act(() => addDocPath("Plain.docx", () => {}));
    expect(h.result.current.some((u) => u.name === "Plain.docx")).toBe(true);
  });

  it("marks a row index-failed when the index run that followed the conversion failed", async () => {
    handlers["docs.convert"] = (input) => ({ id: input.id, index: { error: "model missing" } });
    const h = current();
    await act(() => convertDoc("B", "B.docx", {}, () => {}));
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

  it("shows the index step of a conversion as indexing", async () => {
    let release: () => void = () => {};
    handlers["docs.convert"] = (input, on) =>
      new Promise((r) => {
        on?.({ ...progress("Waiting for the other conversions"), step: "index" } as JobEvent);
        release = () => r({ id: input.id, index: { chunks: 3 } });
      });
    const h = current();
    const pending = convertDoc("I", "I.docx", {}, () => {});
    await vi.waitFor(() =>
      expect(h.result.current.find((u) => u.docId === "I")).toMatchObject({
        phase: "indexing",
        message: "Waiting for the other conversions",
      }),
    );
    await act(async () => {
      release();
      await pending;
    });
    expect(h.result.current.find((u) => u.docId === "I")).toMatchObject({ phase: "done" });
  });

  it("reindexes everything only once the conversions in flight have ended", async () => {
    let end: () => void = () => {};
    handlers["docs.convert"] = (input) => new Promise((r) => (end = () => r({ id: input.id })));
    const h = current();
    const converting = convertDoc("E", "E.docx", {}, () => {});
    await vi.waitFor(() => expect(runs.map((r) => r.name)).toEqual(["docs.convert"]));
    const all = reindexAll(() => {});
    await vi.waitFor(() =>
      expect(h.result.current.find((u) => u.name === "All documents")?.message).toBe(
        "Waiting for the other conversions",
      ),
    );
    expect(runs.filter((r) => r.name === "rag.index")).toHaveLength(0);
    await act(async () => {
      end();
      await Promise.all([converting, all]);
    });
    expect(runs.filter((r) => r.name === "rag.index")).toHaveLength(1);
    expect(h.result.current.find((u) => u.name === "All documents")).toMatchObject({ phase: "done" });
  });

  it("does not join an index run already started: one more run follows it", async () => {
    const releases: (() => void)[] = [];
    handlers["rag.index"] = (_input, on) =>
      new Promise((r) => {
        releases.push(() => r({ chunks: 1 }));
        on?.(progress("Embedding", 1, 2));
      });
    const all = reindexAll(() => {});
    await vi.waitFor(() => expect(releases).toHaveLength(1));
    const again = reindexAll(() => {});
    await act(async () => {
      releases[0]();
      await all;
    });
    await vi.waitFor(() => expect(releases).toHaveLength(2));
    await act(async () => {
      releases[1]();
      await again;
    });
    expect(runs.filter((r) => r.name === "rag.index")).toHaveLength(2);
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
    handlers["docs.addFiles"] = () => new Promise((r) => (release = () => r({ added: [{ id: "G" }], rejected: [] })));
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
    const u = {
      key: 1,
      name: "Spec (3).docx",
      job: "add" as const,
      at: 1000,
      phase: "adding" as const,
      pct: null,
      message: "",
    };
    const d = (name: string, id = "SPEC_3_", uploaded = false) =>
      ({ id, source: { name, sha256: "", file: "source.docx", ...(uploaded ? { uploaded } : {}) } }) as DocRef;
    expect(owns(u, d("C:\\in\\spec (3).DOCX"))).toBe(true);
    expect(owns(u, d("Spec (3).docx", "SPEC_3_", true))).toBe(true);
    expect(owns(u, d("C:\\in\\Other.docx"))).toBe(false);
    expect(owns({ ...u, job: "convert" }, d("C:\\in\\Spec (3).docx"))).toBe(false);
    expect(owns({ ...u, docId: "SPEC_3_" }, d("C:\\elsewhere.docx"))).toBe(true);
    expect(owns({ ...u, docId: "SPEC_3_" }, d("C:\\in\\Spec (3).docx", "OTHER"))).toBe(false);
    expect(owns({ ...u, phase: "failed" }, d("C:\\in\\Spec (3).docx"))).toBe(false);
  });

  it("reads base64 and fails with a default message", async () => {
    expect(await readBase64(new Blob(["ok"]))).toBe("b2s=");
  });
});
