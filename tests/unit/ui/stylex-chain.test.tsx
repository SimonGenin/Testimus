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

  it("gives each explicit theme its own class on the root, and none to the system theme", () => {
    expect(themeClass("system")).toBe("");
    expect(themeClass("dark")).not.toBe("");
    expect(themeClass("dark")).not.toBe(themeClass("light"));
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.className).toBe(themeClass("dark"));
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.documentElement.className).toBe("");
  });
});
