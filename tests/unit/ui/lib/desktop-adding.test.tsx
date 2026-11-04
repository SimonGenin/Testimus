// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { jobNotice } from "../../../../src/ui/components/shell/DesktopBridge.tsx";
import { desktop, pathJoin, taskbarFraction, windowTitle } from "../../../../src/ui/lib/desktop.ts";
import { addDocFiles } from "../../../../src/ui/lib/uploads.ts";
import { api, fakeDesktop, fakeFetch, named, noDesktop } from "../../helpers/ui-desktop.tsx";

beforeEach(() => {
  fakeFetch();
  setProject("C:\\p");
});

afterEach(() => {
  cleanup();
  noDesktop();
  setProject(null);
  vi.unstubAllGlobals();
  document.title = "";
});

const job = (over: Partial<Job>): Job => ({
  id: "j1",
  kind: "generate",
  subject: "Le disjoncteur",
  status: "running",
  startedAt: "2026-11-02T10:00:00Z",
  ...over,
});

describe("lib/desktop", () => {
  it("is null without the bridge and the bridge once the shell has put it there", () => {
    expect(desktop()).toBeNull();
    const d = fakeDesktop();
    expect(desktop()).toBe(d);
  });

  it("joins paths with the separator the folder already uses", () => {
    expect(pathJoin("C:\\p\\", "docs", "SOSIE_3")).toBe("C:\\p\\docs\\SOSIE_3");
    expect(pathJoin("C:/p", "tests", "local-1", "test.md")).toBe("C:/p/tests/local-1/test.md");
    expect(pathJoin("D:\\Tests LFRPS12", "tests", "x", "test.md")).toBe("D:\\Tests LFRPS12\\tests\\x\\test.md");
  });

  it("titles the window with the project", () => {
    expect(windowTitle("RATP Sosie")).toBe("Testimus — RATP Sosie");
    expect(windowTitle()).toBe("Testimus");
  });

  it("averages the running jobs for the taskbar, a job without a total counting as started", () => {
    expect(taskbarFraction([])).toBeNull();
    expect(taskbarFraction([{ done: 0, total: 0 }])).toBe(0);
    expect(taskbarFraction([{ done: 3, total: 4 }])).toBe(0.75);
    expect(
      taskbarFraction([
        { done: 4, total: 4 },
        { done: 0, total: 0 },
      ]),
    ).toBe(0.5);
    expect(taskbarFraction([{ done: 9, total: 4 }])).toBe(1);
  });

  it("says how a job ended in a notification", () => {
    const done = jobNotice(job({ status: "done", result: { tests: ["a", "b"] } }));
    expect(done).toEqual({ title: "Generate tests finished", body: "Le disjoncteur\nDone · 2 tests written" });
    const failed = jobNotice(job({ kind: "claude", status: "failed", error: "Claude is not signed in.\nmore" }));
    expect(failed.title).toBe("Claude request failed");
    expect(failed.body).toContain("Failed · Claude is not signed in.");
  });
});

describe("Documents › adding", () => {
  const docx = () => new File(["PK-word"], "SOSIE_3.docx");
  const pdf = () => new File(["%PDF"], "SOSIE_3.pdf");

  beforeEach(() => {
    api.routes["docs.addFiles"] = () => ({ added: [{ id: "SOSIE_3" }], rejected: [] });
    api.routes["rag.index"] = () => ({ chunks: 1 });
  });

  it("with the bridge, a dropped or chosen file goes to the core by path, no base64", async () => {
    fakeDesktop({ paths: { "SOSIE_3.docx": "C:\\specs\\SOSIE_3.docx", "SOSIE_3.pdf": "C:\\specs\\SOSIE_3.pdf" } });
    await addDocFiles([docx(), pdf()], () => {});
    expect(named("docs.addFiles")).toHaveLength(1);
    expect(named("docs.addFiles")[0].input).toEqual({
      files: [{ path: "C:\\specs\\SOSIE_3.docx" }, { path: "C:\\specs\\SOSIE_3.pdf" }],
    });
  });

  it("falls back to base64 when the bridge has no path for the file, or there is no bridge", async () => {
    fakeDesktop({ paths: {} });
    await addDocFiles([docx()], () => {});
    noDesktop();
    await addDocFiles([new File(["PK"], "Other.docx")], () => {});
    const [a, b] = named("docs.addFiles").map((c) => (c.input as { files: Record<string, unknown>[] }).files[0]);
    expect(a).toMatchObject({ name: "SOSIE_3.docx", dataBase64: btoa("PK-word") });
    expect(a.path).toBeUndefined();
    expect(b).toMatchObject({ name: "Other.docx", dataBase64: btoa("PK") });
  });
});
