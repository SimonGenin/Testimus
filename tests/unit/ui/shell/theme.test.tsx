// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writePref } from "../../../../src/ui/lib/prefs.ts";
import { followTheme, themeClass } from "../../../../src/ui/lib/theme.ts";

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme", () => {
  it("gives <html> the dark class when someone else sets data-theme", async () => {
    const stop = followTheme();
    const system = document.documentElement.className;
    document.documentElement.dataset.theme = "dark";
    await new Promise((r) => setTimeout(r, 0));
    expect(document.documentElement.className).toBe(themeClass("dark"));
    expect(document.documentElement.className).not.toBe(system);
    stop();
  });

  it("keeps <html> on the theme preference, wherever it is written", () => {
    const stop = followTheme();
    expect(document.documentElement.dataset.theme).toBeUndefined();
    act(() => writePref("theme", "dark"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    const dark = document.documentElement.className;
    localStorage.setItem("testimus.theme", "light");
    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "testimus.theme" })));
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.className).not.toBe(dark);
    stop();
    act(() => writePref("theme", "dark"));
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
