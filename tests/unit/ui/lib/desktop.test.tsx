// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { project, setProject } from "../../../../src/ui/api.ts";
import {
  openExternal,
  pathOf,
  pickFiles,
  pickFolder,
  reveal,
  showProject,
  taskbarFraction,
  tracked,
} from "../../../../src/ui/lib/desktop.ts";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { fakeNet } from "../../helpers/ui-data.tsx";
import { fakeDesktop, noDesktop } from "../../helpers/ui-desktop.tsx";

beforeEach(() => fakeNet());

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
  localStorage.clear();
  sessionStorage.clear();
});

describe("desktop helpers", () => {
  it("returns nothing without the bridge", async () => {
    expect(await pickFolder("t")).toBeNull();
    expect(await pickFiles("t", [], false)).toEqual([]);
    expect(pathOf(new File([], "a.docx"))).toBe("");
    await reveal("C:\\p");
    expect(openExternal("https://x")).toBe(false);
  });

  it("turns bridge failures into toasts", async () => {
    const d = fakeDesktop();
    const { result } = renderHook(() => useToasts());
    const titles = () => result.current.map((t) => t.title);
    const clear = () =>
      act(() => {
        for (const t of result.current) closeToast(t.id, true);
      });
    d.pickFolder.mockRejectedValueOnce(new Error("no dialog"));
    expect(await pickFolder("t")).toBeNull();
    d.pickFiles.mockRejectedValueOnce(new Error("no dialog"));
    expect(await pickFiles("t", [{ name: "Word", extensions: ["docx"] }], true)).toEqual([]);
    expect(titles()).toEqual(["Could not open the folder dialog", "Could not open the file dialog"]);
    clear();
    d.reveal.mockResolvedValueOnce(false);
    await reveal("C:gone");
    d.reveal.mockRejectedValueOnce(new Error("shell"));
    await reveal("C:p");
    d.openExternal.mockRejectedValueOnce(new Error("blocked"));
    expect(openExternal("https://x")).toBe(true);
    await vi.waitFor(() => expect(result.current.length).toBe(3));
    expect(titles()).toEqual([
      "Could not show it in Explorer",
      "Could not show it in Explorer",
      "Could not open the link",
    ]);
    clear();
    d.pathOf.mockReturnValueOnce("C:a.docx");
    expect(pathOf(new File([], "a.docx"))).toBe("C:a.docx");
  });

  it("follows a project the core opened and remembers it", () => {
    const refreshInfo = vi.fn();
    const testsChanged = vi.fn();
    expect(showProject({ refreshInfo, testsChanged }, "C:\\p\\")).toBe("C:\\p\\");
    expect(project()).toBe("C:\\p\\");
    expect(localStorage.getItem("testimus.project")).toBe("C:\\p\\");
    expect(refreshInfo).toHaveBeenCalled();
    expect(testsChanged).toHaveBeenCalled();
  });

  it("tracks progress for the taskbar", () => {
    expect(tracked({})).toEqual({ done: 0, total: 0 });
    expect(taskbarFraction([])).toBeNull();
    expect(
      taskbarFraction([
        { done: 5, total: 2 },
        { done: 0, total: 0 },
      ]),
    ).toBe(0.5);
  });
});
