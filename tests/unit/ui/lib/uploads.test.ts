// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef, Job } from "../../../../src/core/types.ts";
import { ApiError, setProject } from "../../../../src/ui/lib/data/client.ts";
import { callsOf, dataWrapper, FakeES, fakeEvents, fakeNet, net, status } from "../../helpers/ui-data.tsx";

const runs: { name: string; input: Record<string, unknown> }[] = [];
type Handler = (input: Record<string, unknown>, onStart: (id: string) => void) => unknown;
let handlers: Record<string, Handler> = {};

vi.mock("../../../../src/ui/lib/data/client.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/ui/lib/data/client.ts")>();
  return {
    ...real,
    run: vi.fn(async (name: string, input: Record<string, unknown>, _on: unknown, onStart?: (id: string) => void) => {
      runs.push({ name, input });
      const h = handlers[name];
      if (!h) throw new Error(`no handler ${name}`);
      return await h(input, (id) => onStart?.(id));
    }),
  };
});

const toasts: unknown[] = [];
vi.mock("../../../../src/ui/lib/toast.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../../src/ui/lib/toast.ts")>();
  return { ...real, toast: vi.fn((t: unknown) => toasts.push(t)) };
});

const {
  addDocFiles,
  addDocPaths,
  conversionsLine,
  convertDoc,
  dismissUpload,
  forgetSettled,
  importClaude,
  owns,
  readBase64,
  reindexAll,
  setImportClaude,
  settled,
  uploadsOf,
  useUploads,
} = await import("../../../../src/ui/lib/uploads.ts");

const T0 = Date.parse("2026-11-04T10:00:00.000Z");
const iso = (ms: number) => new Date(T0 + ms).toISOString();
const job = (o: Partial<Job>): Job => ({
  id: "j",
  kind: "docs.convert",
  subject: "A",
  status: "running",
  startedAt: iso(0),
  ...o,
});
const view = (now = T0 + 10_000, more: Partial<Parameters<typeof uploadsOf>[2]> = {}) => ({
  since: T0 - 1,
  dismissed: new Set<string>(),
  now,
  project: "C:\\p",
  ...more,
});

let jobs: Job[] = [];
const current = () => renderHook(() => useUploads(), { wrapper: dataWrapper() });

beforeEach(() => {
  fakeNet();
  fakeEvents();
  setProject("C:\\p");
  jobs = [];
  net.routes["jobs.list"] = () => jobs;
  runs.length = 0;
  toasts.length = 0;
  handlers = {
    "docs.addFiles": (input) => {
      const files = input.files as { name?: string; path?: string }[];
      const name = (f: { name?: string; path?: string }) => f.name ?? String(f.path).split(/[\\/]/).pop() ?? "";
      const isDoc = (f: { name?: string; path?: string }) => /\.(docx|pdf)$/i.test(name(f));
      return {
        added: files.filter(isDoc).map((f) => ({ id: name(f) })),
        rejected: files
          .filter((f) => !isDoc(f))
          .map((f) => ({
            name: name(f),
            why: "Only Word (.docx) and PDF files can be added.",
            code: "not-a-document",
          })),
      };
    },
    "docs.convert": (input) => ({ id: input.id, converted: { with: "", at: "", warnings: [] } }),
    "rag.index": () => ({ chunks: 1 }),
  };
  act(() => forgetSettled());
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setProject(null);
  delete window.testimusDesktop;
});

describe("a folder import", () => {
  it("is one row while it copies, then each conversion it started is its own row", () => {
    const step = (id: string, s: "running" | "done" | "waiting") => ({ id, label: id, status: s });
    const copying = job({ id: "imp", kind: "docs.add", subject: "J5", steps: [step("copy", "running")] });
    expect(uploadsOf([copying], [], view()).map((r) => [r.key, r.phase])).toEqual([["imp", "adding"]]);
    const converting = { ...copying, steps: [step("copy", "done"), step("convert", "running")] };
    const rows = uploadsOf(
      [
        converting,
        job({ id: "c1", subject: "A", parentId: "imp", startedAt: iso(1) }),
        job({ id: "c2", subject: "B", parentId: "imp", startedAt: iso(2) }),
        job({ id: "ix", kind: "rag-index", parentId: "c1", startedAt: iso(3) }),
      ],
      [],
      view(),
    );
    expect(rows.map((r) => [r.key, r.job, r.docId, r.phase])).toEqual([
      ["c1", "convert", "A", "converting"],
      ["c2", "convert", "B", "converting"],
    ]);
  });

  it("a single add that converts in its own job keeps its row while it converts", () => {
    const step = (id: string, s: "running" | "done" | "waiting") => ({ id, label: id, status: s });
    const add = job({ id: "one", kind: "docs.add", subject: "SPEC_A.docx", steps: [step("convert", "running")] });
    expect(uploadsOf([add], [], view()).map((r) => [r.key, r.name, r.phase])).toEqual([
      ["one", "SPEC_A.docx", "adding"],
    ]);
  });
});

describe("several conversions at once", () => {
  it("a conversion waiting for a slot says so, and the list says how many go, wait, and that each is indexed as it ends", () => {
    const step = (id: string, s: "running" | "done" | "waiting") => ({ id, label: id, status: s });
    const going = (id: string, at: number) =>
      job({ id, subject: id, startedAt: iso(at), steps: [step("convert", "running"), step("index", "waiting")] });
    const queued = (id: string, at: number) =>
      job({
        id,
        subject: id,
        startedAt: iso(at),
        message: "Waiting to convert (2 at a time)",
        steps: [step("queue", "running"), step("convert", "waiting"), step("index", "waiting")],
      });
    const rows = uploadsOf([going("A", 0), going("B", 1), queued("C", 2), queued("D", 3)], [], view());
    expect(rows.map((r) => [r.docId, r.phase, r.message])).toEqual([
      ["A", "converting", "Converting"],
      ["B", "converting", "Converting"],
      ["C", "waiting", "Waiting to convert"],
      ["D", "waiting", "Waiting to convert"],
    ]);
    expect(conversionsLine(rows)).toBe("Converting 2 at a time · 2 waiting · indexed as they end");
    expect(conversionsLine(rows.slice(0, 1))).toBeNull();
    const noIndex = uploadsOf([job({ id: "X", subject: "X" }), job({ id: "Y", subject: "Y" })], [], view());
    expect(conversionsLine(noIndex)).toBe("Converting 2 at a time");
  });
});

describe("the rows are the project's jobs", () => {
  it("shows an add, a conversion and an index run as they go, oldest first, and leaves other jobs and child jobs out", () => {
    const rows = uploadsOf(
      [
        job({
          id: "ix",
          kind: "rag-index",
          subject: "index",
          startedAt: iso(3),
          message: "Embedding",
          progress: { done: 1, total: 4 },
        }),
        job({ id: "child", kind: "rag-index", parentId: "cv", startedAt: iso(2) }),
        job({ id: "gen", kind: "generate", startedAt: iso(2) }),
        job({ id: "cv", subject: "SPEC", startedAt: iso(1) }),
        job({ id: "add", kind: "docs.add", subject: "new.pdf", startedAt: iso(0) }),
      ],
      [],
      view(),
    );
    expect(rows).toEqual([
      { key: "add", jobId: "add", job: "add", name: "new.pdf", phase: "adding", pct: null, message: "Adding" },
      {
        key: "cv",
        jobId: "cv",
        job: "convert",
        name: "SPEC",
        docId: "SPEC",
        phase: "converting",
        pct: null,
        message: "Converting",
      },
      { key: "ix", jobId: "ix", job: "index", name: "All documents", phase: "indexing", pct: 25, message: "Embedding" },
    ]);
  });

  it("shows the index step of a conversion as indexing", () => {
    const steps = [
      { id: "convert", label: "Convert", status: "done" as const },
      { id: "index", label: "Index", status: "running" as const },
    ];
    const [row] = uploadsOf([job({ steps, message: "Waiting for the other conversions" })], [], view());
    expect(row).toMatchObject({ phase: "indexing", message: "Waiting for the other conversions" });
  });

  it("says a finished conversion or index run for a few seconds, and an index failure until it is dismissed", () => {
    const done = [
      job({ id: "cv", status: "done", endedAt: iso(1000), result: { id: "A", index: { chunks: 3 } } }),
      job({ id: "ix", kind: "rag-index", status: "done", endedAt: iso(1000), startedAt: iso(1) }),
      job({
        id: "bad",
        subject: "B",
        status: "done",
        endedAt: iso(1000),
        startedAt: iso(2),
        result: { index: { error: "model missing" } },
      }),
    ];
    expect(uploadsOf(done, [], view(T0 + 2000)).map((u) => [u.key, u.phase, u.message, u.pct])).toEqual([
      ["cv", "done", "Converted and indexed", 100],
      ["ix", "done", "Index up to date", 100],
      ["bad", "index-failed", "model missing", null],
    ]);
    expect(uploadsOf(done, [], view(T0 + 6000)).map((u) => u.key)).toEqual(["bad"]);
    expect(uploadsOf(done, [], view(T0 + 2000, { dismissed: new Set(["bad", "cv"]) })).map((u) => u.key)).toEqual([
      "ix",
    ]);
  });

  it("gives a failed or cancelled job its error and fix, and the files the core refused to copy their reason", () => {
    const rows = uploadsOf(
      [
        job({ id: "cv", status: "failed", endedAt: iso(5), error: "source missing", fix: "Add it again" }),
        job({ id: "ix", kind: "rag-index", status: "cancelled", endedAt: iso(5), startedAt: iso(1) }),
        job({
          id: "add",
          kind: "docs.add",
          subject: "2 files",
          status: "done",
          endedAt: iso(5),
          startedAt: iso(2),
          result: {
            added: [],
            rejected: [
              { name: "Twice.docx", why: "Document TWICE already exists.", code: "failed" },
              { name: "notes.txt", why: "not a document", code: "not-a-document" },
            ],
          },
        }),
      ],
      [],
      view(),
    );
    expect(rows.map((u) => [u.key, u.name, u.phase, u.message])).toEqual([
      ["cv", "A", "failed", "source missing"],
      ["ix", "All documents", "index-failed", "Cancelled."],
      ["add:Twice.docx", "Twice.docx", "failed", "Document TWICE already exists."],
    ]);
    expect(rows[0].error).toBeInstanceOf(ApiError);
    expect((rows[0].error as ApiError).fix).toBe("Add it again");
  });

  it("forgets what ended before the screen opened, and shows the page's own rows of this project until the list has their job", () => {
    const ended = job({ id: "old", status: "failed", endedAt: iso(5), error: "x" });
    expect(uploadsOf([ended], [], view(T0 + 10, { since: T0 + 6 }))).toEqual([]);
    const local = [
      {
        key: "local-1",
        name: "a.docx",
        job: "add" as const,
        phase: "reading" as const,
        pct: null,
        message: "Reading",
        project: "C:\\p",
        at: T0,
      },
      {
        key: "local-2",
        name: "b.docx",
        job: "add" as const,
        phase: "adding" as const,
        pct: null,
        message: "Adding",
        project: "C:\\other",
        at: T0,
      },
      {
        key: "local-3",
        name: "SPEC",
        job: "convert" as const,
        phase: "converting" as const,
        pct: null,
        message: "Converting",
        project: "C:\\p",
        jobId: "cv",
        at: T0,
      },
    ];
    expect(uploadsOf([], local, view()).map((u) => u.key)).toEqual(["local-1", "local-3"]);
    expect(uploadsOf([job({ id: "cv", subject: "SPEC" })], local, view()).map((u) => u.key)).toEqual(["cv", "local-1"]);
    expect(uploadsOf([], local, view()).every((u) => !("project" in u) && !("jobId" in u) && !("at" in u))).toBe(true);
  });

  it("is one row when the job comes by the event stream before the call returns its id", () => {
    const adding = { key: "local-1", name: "essai PCC.mp4", job: "add" as const, phase: "adding" as const };
    const local = [{ ...adding, pct: null, message: "Adding", project: "C:\\p", at: T0 + 5 }];
    const add = (o: Partial<Job>) => job({ id: "add-1", kind: "docs.add", subject: "essai PCC.mp4", ...o });
    expect(uploadsOf([add({ startedAt: iso(6) })], local, view()).map((u) => [u.key, u.name])).toEqual([
      ["add-1", "essai PCC.mp4"],
    ]);
    expect(uploadsOf([add({ startedAt: iso(4) })], local, view()).map((u) => u.key)).toEqual(["add-1", "local-1"]);
    expect(uploadsOf([add({ startedAt: iso(6), subject: "other.mp4" })], local, view()).map((u) => u.key)).toEqual([
      "add-1",
      "local-1",
    ]);
    const two = [...local, { ...local[0], key: "local-2", at: T0 + 7 }];
    expect(uploadsOf([add({ startedAt: iso(6) })], two, view()).map((u) => u.key)).toEqual(["add-1", "local-2"]);
    const cv = { key: "local-3", name: "SPEC", job: "convert" as const, phase: "converting" as const, docId: "SPEC" };
    const converting = [{ ...cv, pct: null, message: "Converting", project: "C:\\p", at: T0 }];
    expect(
      uploadsOf([job({ id: "cv", subject: "SPEC", startedAt: iso(1) })], converting, view()).map((u) => u.key),
    ).toEqual(["cv"]);
  });

  it("reads the rows back from the jobs after a reload, and follows them live", async () => {
    jobs = [job({ id: "cv", subject: "SPEC", startedAt: new Date().toISOString(), message: "Converting page 1" })];
    const h = current();
    await waitFor(() => expect(h.result.current).toMatchObject([{ key: "cv", phase: "converting" }]));
    act(() => FakeES.emit({ jobId: "cv", at: "", type: "progress", message: "Converting page 2", done: 2, total: 4 }));
    await waitFor(() => expect(h.result.current[0]).toMatchObject({ message: "Converting page 2", pct: 50 }));
    const end = { ...jobs[0], status: "failed" as const, endedAt: new Date().toISOString(), error: "broke" };
    jobs = [end];
    act(() => FakeES.emit(status(end)));
    await waitFor(() => expect(h.result.current[0]).toMatchObject({ phase: "failed", message: "broke" }));
    act(() => dismissUpload("cv"));
    expect(h.result.current).toEqual([]);
  });
});

describe("what the page starts", () => {
  it("rejects what is not Word or PDF and only copies the rest from base64, without converting", async () => {
    const h = current();
    const onDone = vi.fn();
    await act(() => addDocFiles([new File(["x"], "notes.txt"), new File(["PK"], "A.docx")], onDone));
    expect(toasts[0]).toMatchObject({ tone: "danger", detail: "notes.txt" });
    expect(runs.map((r) => r.name)).toEqual(["docs.addFiles"]);
    expect(runs[0].input).toEqual({
      files: [
        { name: "notes.txt", dataBase64: "eA==" },
        { name: "A.docx", dataBase64: "UEs=" },
      ],
    });
    expect(onDone).toHaveBeenCalledExactlyOnceWith("A.docx");
    expect(h.result.current).toEqual([]);
  });

  it("shows a row for the add from the moment it is asked, until the list has its job", async () => {
    let release: (v: unknown) => void = () => {};
    let start: (id: string) => void = () => {};
    handlers["docs.addFiles"] = (_i, onStart) =>
      new Promise((r) => {
        start = onStart;
        release = r;
      });
    const h = current();
    const pending = addDocPaths(["C:\\d\\G.docx"], () => {});
    await waitFor(() => expect(h.result.current).toMatchObject([{ name: "G.docx", phase: "adding", job: "add" }]));
    jobs = [job({ id: "add-1", kind: "docs.add", subject: "G.docx", message: "Copying" })];
    const reads = callsOf("jobs.list").length;
    act(() => start("add-1"));
    await waitFor(() => expect(callsOf("jobs.list").length).toBeGreaterThan(reads));
    await waitFor(() => expect(h.result.current).toMatchObject([{ key: "add-1", message: "Copying" }]));
    expect(h.result.current).toHaveLength(1);
    await act(async () => {
      release({ added: [{ id: "G" }], rejected: [] });
      await pending;
    });
  });

  it("converts, triages and indexes a document in one job with the context of this job", async () => {
    setImportClaude({ model: "sonnet", effort: "medium" });
    try {
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
    } finally {
      setImportClaude({});
    }
  });

  it("marks a conversion refused before its job failed, and leaves a failure after it to the job's row", async () => {
    handlers["docs.convert"] = () => {
      throw new ApiError("not a docx", "Add the Word file");
    };
    const h = current();
    const onDone = vi.fn();
    await act(() => convertDoc("Broken", "Broken.docx", {}, onDone));
    expect(h.result.current.find((u) => u.docId === "Broken")).toMatchObject({
      phase: "failed",
      message: "not a docx",
      name: "Broken.docx",
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    handlers["docs.convert"] = (_i, onStart) => {
      onStart("cv-9");
      throw new Error("the job failed");
    };
    await act(() => convertDoc("Late", "Late.docx", {}, () => {}));
    expect(h.result.current.some((u) => u.docId === "Late")).toBe(false);
  });

  it("sends a Word file and its PDF together, both by path, for the core to pair", async () => {
    window.testimusDesktop = { pathOf: (f: File) => `C:\\d\\${f.name}` } as never;
    await act(() => addDocFiles([new File(["%"], "spec.PDF"), new File(["PK"], "Spec.docx")], () => {}));
    expect(runs.map((r) => r.input)).toEqual([{ files: [{ path: "C:\\d\\spec.PDF" }, { path: "C:\\d\\Spec.docx" }] }]);
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
    await act(() => addDocPaths(["C:\\d\\Only.pdf", "C:\\d\\other.png"], () => {}));
    expect(runs[0]).toEqual({
      name: "docs.addFiles",
      input: { files: [{ path: "C:\\d\\Only.pdf" }, { path: "C:\\d\\other.png" }] },
    });
    expect(toasts[0]).toMatchObject({ tone: "danger", detail: "other.png" });
  });

  it("marks a row failed when the copy is refused before its job, named by itself when it has no separator", async () => {
    handlers["docs.addFiles"] = () => {
      throw new Error("not found");
    };
    const h = current();
    const onDone = vi.fn();
    await act(() => addDocPaths(["Plain.docx"], onDone));
    expect(h.result.current.find((u) => u.name === "Plain.docx")).toMatchObject({
      phase: "failed",
      message: "not found",
    });
    expect(onDone).toHaveBeenCalledTimes(1);
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
    expect(h.result.current.find((u) => u.name === "C.docx")).toMatchObject({
      phase: "failed",
      message: "The file could not be read.",
    });
    expect(runs).toEqual([]);
  });

  it("asks the core for an index run at once — the core waits for the conversions and for a run under way", async () => {
    setImportClaude({ model: "haiku" });
    let end: () => void = () => {};
    handlers["docs.convert"] = (input) => new Promise((r) => (end = () => r({ id: input.id })));
    try {
      const converting = convertDoc("E", "E.docx", {}, () => {});
      await act(() => Promise.all([reindexAll(() => {}), reindexAll(() => {})]));
      expect(runs.map((r) => r.name)).toEqual(["docs.convert", "rag.index", "rag.index"]);
      expect(runs[1].input).toEqual({ model: "haiku" });
      end();
      await act(() => converting);
    } finally {
      setImportClaude({});
    }
  });

  it("reports an index run refused before its job, with its fix", async () => {
    handlers["rag.index"] = () => {
      throw new ApiError("No model", "Install a pack");
    };
    const h = current();
    const onDone = vi.fn();
    await act(() => reindexAll(onDone));
    expect(onDone).toHaveBeenCalled();
    const row = h.result.current.find((u) => u.name === "All documents");
    expect(row).toMatchObject({ phase: "index-failed", message: "No model" });
    expect((row?.error as ApiError | undefined)?.fix).toBe("Install a pack");
  });

  it("tells the page that asked only while it still shows that project", async () => {
    let release: (v: unknown) => void = () => {};
    handlers["docs.addFiles"] = () => new Promise((r) => (release = r));
    const onDone = vi.fn();
    const pending = addDocPaths(["C:\\d\\A.docx"], onDone);
    await waitFor(() => expect(runs).toHaveLength(1));
    setProject("C:\\other");
    await act(async () => {
      release({ added: [{ id: "A" }], rejected: [] });
      await pending;
    });
    expect(onDone).not.toHaveBeenCalled();
    const h = current();
    expect(h.result.current).toEqual([]);
  });

  it("dismisses one row, and forgets the settled rows when the screen is left", async () => {
    handlers["docs.addFiles"] = () => {
      throw new Error("x");
    };
    const h = current();
    await act(() => addDocPaths(["C:\\d\\one.docx"], () => {}));
    await act(() => addDocPaths(["C:\\d\\two.docx"], () => {}));
    expect(h.result.current.map((u) => u.name)).toEqual(["one.docx", "two.docx"]);
    act(() => dismissUpload(h.result.current[0].key));
    expect(h.result.current.map((u) => u.name)).toEqual(["two.docx"]);
    act(() => forgetSettled());
    expect(h.result.current).toEqual([]);
  });

  it("ties a listed document to the upload still adding it", () => {
    const u = {
      key: "1",
      name: "Spec (3).docx",
      job: "add" as const,
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
    expect(settled({ ...u, phase: "index-failed" })).toBe(true);
  });

  it("reads base64", async () => {
    expect(await readBase64(new Blob(["ok"]))).toBe("b2s=");
  });
});
