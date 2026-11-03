// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { DesktopBridge, jobNotice } from "../../src/ui/components/shell/DesktopBridge.tsx";
import { AppContext, type AppState } from "../../src/ui/lib/app.ts";
import { desktop, pathJoin, taskbarFraction, windowTitle } from "../../src/ui/lib/desktop.ts";
import { addDocFiles } from "../../src/ui/lib/uploads.ts";
import { DocumentsScreen } from "../../src/ui/screens/documents/DocumentsScreen.tsx";
import { api, app, FakeEventSource, fakeDesktop, fakeFetch, named, noDesktop } from "./ui-desktop-helpers.tsx";

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

function renderBridge(over: Partial<AppState> = {}, booted = true) {
  const a = app(over);
  const view = render(
    <AppContext.Provider value={a}>
      <DesktopBridge booted={booted} />
    </AppContext.Provider>,
  );
  return { a, view };
}

describe("DesktopBridge", () => {
  beforeEach(() => {
    FakeEventSource.last = null;
    vi.stubGlobal("EventSource", FakeEventSource);
    api.routes["jobs.list"] = () => [];
  });

  it("titles the page « Testimus — <project> » in the browser too, and renders nothing", () => {
    const { view } = renderBridge();
    expect(document.title).toBe("Testimus — RATP Sosie");
    expect(view.container).toBeEmptyDOMElement();
    view.rerender(
      <AppContext.Provider value={app({ info: null })}>
        <DesktopBridge booted />
      </AppContext.Provider>,
    );
    expect(document.title).toBe("Testimus");
  });

  it("without the bridge: no job list read, no taskbar", () => {
    renderBridge();
    expect(named("jobs.list")).toHaveLength(0);
  });

  it("follows Generate, Index, Check and Pull jobs on the taskbar, then clears it", async () => {
    const d = fakeDesktop();
    api.routes["jobs.list"] = () => [job({ id: "j0", kind: "rag-index", progress: { done: 1, total: 4 } })];
    const { view } = renderBridge();
    await waitFor(() => expect(d.setProgress).toHaveBeenLastCalledWith(0.25));
    const es = FakeEventSource.last;
    expect(es).not.toBeNull();
    act(() => {
      es?.emit({ jobId: "j1", at: "", type: "status", job: job({ id: "j1", kind: "generate" }) });
      es?.emit({ jobId: "j9", at: "", type: "status", job: job({ id: "j9", kind: "chat" }) });
    });
    expect(d.setProgress).toHaveBeenLastCalledWith(0.13);
    act(() => es?.emit({ jobId: "j1", at: "", type: "progress", message: "Writing", done: 1, total: 2 }));
    expect(d.setProgress).toHaveBeenLastCalledWith(0.38);
    act(() => {
      es?.emit({ jobId: "j0", at: "", type: "status", job: job({ id: "j0", kind: "rag-index", status: "done" }) });
      es?.emit({ jobId: "j1", at: "", type: "status", job: job({ id: "j1", status: "cancelled" }) });
    });
    expect(d.setProgress).toHaveBeenLastCalledWith(null);
    view.unmount();
    expect(d.setProgress).toHaveBeenLastCalledWith(null);
  });

  it("notifies the end of a job and a failed Claude run, once each, never a cancel", () => {
    const d = fakeDesktop();
    renderBridge();
    const es = FakeEventSource.last;
    act(() => {
      es?.emit({ jobId: "a", at: "", type: "status", job: job({ id: "a", status: "done", result: { tests: [] } }) });
      es?.emit({ jobId: "a", at: "", type: "status", job: job({ id: "a", status: "done", result: { tests: [] } }) });
      es?.emit({ jobId: "b", at: "", type: "status", job: job({ id: "b", kind: "fix", status: "failed" }) });
      es?.emit({ jobId: "c", at: "", type: "status", job: job({ id: "c", status: "cancelled" }) });
    });
    expect(d.notify).toHaveBeenCalledTimes(2);
    expect(d.notify.mock.calls[0][0]).toMatchObject({ title: "Generate tests finished" });
    expect(d.notify.mock.calls[1][0]).toMatchObject({ title: "Claude fix failed" });
  });

  it("opens a folder handed by a second launch, once the app has read its first project", async () => {
    const d = fakeDesktop();
    api.routes["project.open"] = (i) => ({ dir: i.dir });
    const { a, view } = renderBridge({ route: { screen: "setup" } }, false);
    expect(d.onOpenProject).not.toHaveBeenCalled();
    view.rerender(
      <AppContext.Provider value={a}>
        <DesktopBridge booted />
      </AppContext.Provider>,
    );
    expect(d.onOpenProject).toHaveBeenCalledTimes(1);
    act(() => d.open?.("D:\\Other project"));
    await waitFor(() => expect(a.refreshInfo).toHaveBeenCalled());
    expect(named("project.open")[0].input).toEqual({ dir: "D:\\Other project" });
    expect(localStorage.getItem("testimus.project")).toBe("D:\\Other project");
    expect(a.testsChanged).toHaveBeenCalled();
    await waitFor(() => expect(a.navigate).toHaveBeenCalledWith("documents"));
  });
});

describe("Documents › adding", () => {
  const docx = () => new File(["PK-word"], "SOSIE_3.docx");
  const pdf = () => new File(["%PDF"], "SOSIE_3.pdf");

  beforeEach(() => {
    api.routes["docs.add"] = () => ({ id: "SOSIE_3" });
    api.routes["rag.index"] = () => ({ chunks: 1 });
  });

  it("with the bridge, a dropped or chosen file goes to the core by path, no base64", async () => {
    fakeDesktop({ paths: { "SOSIE_3.docx": "C:\\specs\\SOSIE_3.docx", "SOSIE_3.pdf": "C:\\specs\\SOSIE_3.pdf" } });
    await addDocFiles([docx(), pdf()], () => {});
    expect(named("docs.add")).toHaveLength(1);
    expect(named("docs.add")[0].input).toEqual({
      file: "C:\\specs\\SOSIE_3.docx",
      pdf: "C:\\specs\\SOSIE_3.pdf",
      convert: false,
    });
  });

  it("falls back to base64 when the bridge has no path for the file, or there is no bridge", async () => {
    fakeDesktop({ paths: {} });
    await addDocFiles([docx()], () => {});
    noDesktop();
    await addDocFiles([new File(["PK"], "Other.docx")], () => {});
    const [a, b] = named("docs.add").map((c) => c.input);
    expect(a).toMatchObject({ name: "SOSIE_3.docx", dataBase64: btoa("PK-word") });
    expect(a.file).toBeUndefined();
    expect(b).toMatchObject({ name: "Other.docx", dataBase64: btoa("PK") });
  });

  const docRef = {
    id: "SOSIE_3",
    code: "SOSIE_3",
    title: "Spécification",
    version: "01",
    date: "",
    kind: "spec",
    status: "validated",
    source: { path: "C:\\specs\\SOSIE_3.docx", sha256: "x", file: "source.docx" },
    convertedWith: "t",
    convertedAt: "",
    warnings: [],
    indexed: "fresh",
  };

  function renderDocs() {
    api.routes["docs.list"] = () => [docRef];
    api.routes["docs.show"] = (i) =>
      i.anchor ? { md: "text" } : { doc: docRef, context: "", toc: [], requirements: [], figures: [], md: "" };
    return render(
      <AppContext.Provider value={app()}>
        <DocumentsScreen />
      </AppContext.Provider>,
    );
  }

  it("Add documents opens the native picker and adds by path; Show in Explorer reveals docs/<id>", async () => {
    const d = fakeDesktop({ files: ["C:\\specs\\SOSIE_3.docx"] });
    renderDocs();
    const click = vi.spyOn(HTMLInputElement.prototype, "click");
    fireEvent.click(await screen.findByRole("button", { name: "Add documents" }));
    await waitFor(() => expect(named("docs.add")).toHaveLength(1));
    expect(click).not.toHaveBeenCalled();
    expect(d.pickFiles).toHaveBeenCalledWith({
      title: "Add documents",
      filters: [{ name: "Word or PDF", extensions: ["docx", "pdf"] }],
      multiple: true,
    });
    expect(named("docs.add")[0].input).toEqual({ file: "C:\\specs\\SOSIE_3.docx", convert: false });
    fireEvent.click(await screen.findByRole("button", { name: "Show in Explorer" }));
    await waitFor(() => expect(d.reveal).toHaveBeenCalledWith("C:\\p\\docs\\SOSIE_3"));
  });

  it("without the bridge: the hidden file input, no Show in Explorer", async () => {
    renderDocs();
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    fireEvent.click(await screen.findByRole("button", { name: "Add documents" }));
    expect(click).toHaveBeenCalled();
    await screen.findByRole("heading", { name: "Spécification" });
    expect(screen.queryByRole("button", { name: "Show in Explorer" })).toBeNull();
  });

  it("a dropped file in the desktop window is added by its path", async () => {
    fakeDesktop({ paths: { "SOSIE_3.docx": "C:\\specs\\SOSIE_3.docx" } });
    const view = renderDocs();
    await screen.findByRole("heading", { name: "Spécification" });
    const zone = view.container.querySelector(".docs-screen") as HTMLElement;
    fireEvent.drop(zone, { dataTransfer: { files: [docx()], types: ["Files"] } });
    await waitFor(() => expect(named("docs.add")).toHaveLength(1));
    expect(named("docs.add")[0].input).toEqual({ file: "C:\\specs\\SOSIE_3.docx", convert: false });
  });
});
