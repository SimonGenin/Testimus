// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { readPref, writePref } from "../../../../src/ui/lib/prefs.ts";
import { applyTheme, nextTheme, readTheme, setThemeEverywhere } from "../../../../src/ui/lib/theme.ts";
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
    expect(readPref("stepLayout")).toBe("stacked");
    writePref("stepLayout", "split");
    expect(readPref("editorWidth")).toBeNull();
    expect(readPref("setupShown")).toBe(false);
    writePref("setupShown", true);
  });
});
