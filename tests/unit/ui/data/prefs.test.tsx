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
    expect(readPref("docsTocWidth")).toBeNull();
    writePref("theme", "dark");
    writePref("showDetails", false);
    writePref("docsTocWidth", 420);
    expect(localStorage.getItem("testimus.theme")).toBe("dark");
    expect(localStorage.getItem("testimus.showDetails")).toBe("0");
    expect(localStorage.getItem("testimus.docsTocWidth")).toBe("420");
    expect(readPref("theme")).toBe("dark");
    expect(readPref("showDetails")).toBe(false);
    expect(readPref("docsTocWidth")).toBe(420);
  });

  it("ignore a stored value out of range or unknown, and forget a value set back to its default", () => {
    localStorage.setItem("testimus.theme", "purple");
    localStorage.setItem("testimus.docsTocWidth", "9000");
    expect(readPref("theme")).toBe("system");
    expect(readPref("docsTocWidth")).toBeNull();
    writePref("stepLayout", "split");
    writePref("stepLayout", "stacked");
    expect(localStorage.getItem("testimus.stepLayout")).toBeNull();
  });

  it("read a switch an older version stored as true or false", () => {
    localStorage.setItem("testimus.alwaysOnTop", "true");
    expect(readPref("alwaysOnTop")).toBe(true);
    localStorage.setItem("testimus.showDetails", "false");
    expect(readPref("showDetails")).toBe(false);
  });

  it("keep a session preference only in the tab", () => {
    writePref("setupShown", true);
    expect(sessionStorage.getItem("testimus.setupShown")).toBe("1");
    expect(localStorage.getItem("testimus.setupShown")).toBeNull();
    expect(savedPrefs()).toEqual({});
  });

  it("re-render their readers when set, here or in another tab", () => {
    const h = renderHook(() => usePref("showDetails"));
    expect(h.result.current[0]).toBe(true);
    act(() => h.result.current[1](false));
    expect(h.result.current[0]).toBe(false);
    localStorage.setItem("testimus.showDetails", "1");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "testimus.showDetails" }));
    });
    expect(h.result.current[0]).toBe(true);
  });

  it("are saved and restored as a whole (the desktop mirror), refusing values they do not know", () => {
    writePref("theme", "light");
    writePref("editorWidth", 900);
    const saved = savedPrefs();
    expect(saved).toEqual({ "testimus.theme": "light", "testimus.editorWidth": "900" });
    localStorage.clear();
    restorePrefs({ ...saved, "testimus.docsTocWidth": "1", "testimus.unknown": "x" });
    expect(readPref("theme")).toBe("light");
    expect(readPref("editorWidth")).toBe(900);
    expect(localStorage.getItem("testimus.docsTocWidth")).toBeNull();
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
