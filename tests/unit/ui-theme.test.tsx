// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "../../src/ui/components/shell/ThemeToggle.tsx";

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("theme toggle", () => {
  it("cycles system → light → dark → system on data-theme and persists it", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("System");
    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("testimus.theme")).toBe("light");
    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(button).toHaveTextContent("Dark");
    fireEvent.click(button);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(localStorage.getItem("testimus.theme")).toBe("system");
  });

  it("starts from the stored theme", () => {
    localStorage.setItem("testimus.theme", "dark");
    render(<ThemeToggle />);
    expect(screen.getByRole("button")).toHaveTextContent("Dark");
  });
});
