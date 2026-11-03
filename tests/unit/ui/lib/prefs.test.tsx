// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import {
  applyTheme,
  nextTheme,
  readPref,
  readSession,
  readString,
  readTheme,
  setThemeEverywhere,
  writePref,
  writeSession,
} from "../../../../src/ui/lib/theme.ts";
import { fakeNet } from "../../cov-uishell-helpers.tsx";
import { noDesktop } from "../../ui-desktop-helpers.tsx";

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

describe("theme and preferences", () => {
  it("reads, applies and cycles the theme", () => {
    expect(readTheme()).toBe("system");
    localStorage.setItem("testimus.theme", "purple");
    expect(readTheme()).toBe("system");
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(readTheme()).toBe("dark");
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(nextTheme("dark")).toBe("system");
    const seen = vi.fn();
    window.addEventListener("testimus:theme", (e) => seen((e as CustomEvent).detail));
    setThemeEverywhere("light");
    expect(seen).toHaveBeenCalledWith("light");
  });

  it("reads and writes preferences and session values", () => {
    const LAYOUTS = ["stacked", "split"] as const;
    expect(readPref("testimus.stepLayout", LAYOUTS, "stacked")).toBe("stacked");
    writePref("testimus.stepLayout", "split");
    expect(readPref("testimus.stepLayout", LAYOUTS, "stacked")).toBe("split");
    writePref("testimus.stepLayout", "z");
    expect(readPref("testimus.stepLayout", LAYOUTS, "stacked")).toBe("stacked");
    expect(readString("testimus.missing")).toBe("");
    writePref("testimus.missing", "x");
    expect(readString("testimus.missing")).toBe("");
    writePref("testimus.editorWidth", "900");
    expect(readString("testimus.editorWidth")).toBe("900");
    expect(readSession("testimus.setupShown")).toBe("0");
    writeSession("testimus.setupShown", "1");
    expect(readSession("testimus.setupShown")).toBe("1");
    expect(localStorage.getItem("testimus.setupShown")).toBeNull();
  });

  it("survives a storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readTheme()).toBe("system");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyTheme("system");
    expect(readPref("testimus.stepLayout", ["stacked"] as const, "stacked")).toBe("stacked");
    writePref("testimus.stepLayout", "split");
    expect(readString("testimus.editorWidth")).toBe("");
    expect(readSession("testimus.setupShown")).toBe("0");
    writeSession("testimus.setupShown", "1");
  });
});
