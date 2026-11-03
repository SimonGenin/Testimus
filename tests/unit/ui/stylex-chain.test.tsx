// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, themeClass } from "../../../src/ui/lib/theme.ts";
import { KitScreen } from "../../../src/ui/screens/kit/KitScreen.tsx";

afterEach(cleanup);

describe("StyleX chain", () => {
  it("compiles the styles of a component into atomic class names", () => {
    render(<KitScreen />);
    const probe = screen.getByRole("button", { name: "StyleX probe" });
    expect(probe.className.split(" ").length).toBeGreaterThan(4);
    expect(screen.getByRole("region", { name: "Component kit" }).className).not.toBe("");
  });

  it("gives the root the page's base, and each explicit theme its own class on top", () => {
    const base = themeClass("system").split(" ");
    expect(base.length).toBeGreaterThan(3);
    expect(themeClass("dark")).not.toBe(themeClass("light"));
    for (const t of ["dark", "light"] as const) expect(themeClass(t).split(" ")).toEqual(expect.arrayContaining(base));
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.className).toBe(themeClass("dark"));
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.className).toBe(themeClass("system"));
  });
});
