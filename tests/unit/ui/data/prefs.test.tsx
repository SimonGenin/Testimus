// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readPref,
  readRecent,
  restorePrefs,
  savedPrefs,
  usePref,
  writePref,
  writeRecent,
} from "../../../../src/ui/lib/prefs.ts";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(cleanup);

describe("presentation preferences", () => {
  it("give their default until set, and keep the stored strings other readers expect", () => {
    expect(readPref("theme")).toBe("system");
    expect(readPref("showDetails")).toBe(true);
    expect(readPref("dockWidth")).toBeNull();
    writePref("theme", "dark");
    writePref("showDetails", false);
    writePref("dockWidth", 420);
    expect(localStorage.getItem("testimus.theme")).toBe("dark");
    expect(localStorage.getItem("testimus.showDetails")).toBe("0");
    expect(localStorage.getItem("testimus.dockWidth")).toBe("420");
    expect(readPref("theme")).toBe("dark");
    expect(readPref("showDetails")).toBe(false);
    expect(readPref("dockWidth")).toBe(420);
  });

  it("ignore a stored value out of range or unknown, and forget a value set back to its default", () => {
    localStorage.setItem("testimus.theme", "purple");
    localStorage.setItem("testimus.dockWidth", "9000");
    expect(readPref("theme")).toBe("system");
    expect(readPref("dockWidth")).toBeNull();
    writePref("stepLayout", "split");
    writePref("stepLayout", "stacked");
    expect(localStorage.getItem("testimus.stepLayout")).toBeNull();
  });

  it("keep a session preference only in the tab", () => {
    writePref("setupShown", true);
    expect(sessionStorage.getItem("testimus.setupShown")).toBe("1");
    expect(localStorage.getItem("testimus.setupShown")).toBeNull();
    expect(savedPrefs()).toEqual({});
  });

  it("re-render their readers when set, here or in another tab", () => {
    const h = renderHook(() => usePref("jobsGroup"));
    expect(h.result.current[0]).toBe(true);
    act(() => h.result.current[1](false));
    expect(h.result.current[0]).toBe(false);
    localStorage.setItem("testimus.jobsGroup", "1");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "testimus.jobsGroup" }));
    });
    expect(h.result.current[0]).toBe(true);
  });

  it("are saved and restored as a whole (the desktop mirror), refusing values they do not know", () => {
    writePref("theme", "light");
    writePref("sourceWidth", 500);
    const saved = savedPrefs();
    expect(saved).toEqual({ "testimus.theme": "light", "testimus.sourceWidth": "500" });
    localStorage.clear();
    restorePrefs({ ...saved, "testimus.queueWidth": "1", "testimus.unknown": "x" });
    expect(readPref("theme")).toBe("light");
    expect(readPref("sourceWidth")).toBe(500);
    expect(localStorage.getItem("testimus.queueWidth")).toBeNull();
    expect(localStorage.getItem("testimus.unknown")).toBeNull();
  });

  it("keep the palette's recent hits per project", () => {
    writeRecent("/a", [{ id: 1 }]);
    expect(readRecent("/a")).toEqual([{ id: 1 }]);
    expect(readRecent("/b")).toEqual([]);
    localStorage.setItem("testimus.search.recent:/c", "not json");
    expect(readRecent("/c")).toEqual([]);
  });
});
