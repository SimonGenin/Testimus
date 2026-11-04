// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Text } from "../../../../src/ui/components/ui/Text.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Text, multiline", () => {
  it("grows to its content, and an empty one keeps its resting height", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(40);
    const { rerender } = render(<Text label="Action" multiline value="hello" onChange={() => {}} />);
    const area = screen.getByRole("textbox", { name: "Action" });
    expect(area.style.height).toBe("40px");
    rerender(<Text label="Action" multiline value="" onChange={() => {}} />);
    expect(area.style.height).toBe("");
  });

  it("a single line does not set its height", () => {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(40);
    render(<Text label="Name" value="hello" onChange={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Name" }).style.height).toBe("");
  });
});
