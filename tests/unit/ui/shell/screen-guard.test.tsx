// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenGuard } from "../../../../src/ui/app/ScreenGuard.tsx";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Broken({ bad }: { bad: boolean }) {
  if (bad) throw new Error("doc.json: Unexpected token } in JSON at position 12");
  return <p>The documents</p>;
}

describe("ScreenGuard (a screen that throws leaves the shell standing)", () => {
  it("shows what broke with Reload instead of a blank page, and tries again on another route", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    const { rerender } = render(
      <ScreenGuard route="documents/A" onReload={reload}>
        <Broken bad />
      </ScreenGuard>,
    );
    expect(screen.getByText("This screen could not be drawn")).toBeInTheDocument();
    expect(screen.getByText(/doc\.json: Unexpected token/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(reload).toHaveBeenCalledTimes(1);
    rerender(
      <ScreenGuard route="documents/A" onReload={reload}>
        <Broken bad={false} />
      </ScreenGuard>,
    );
    expect(screen.getByText("This screen could not be drawn")).toBeInTheDocument();
    rerender(
      <ScreenGuard route="documents/B" onReload={reload}>
        <Broken bad={false} />
      </ScreenGuard>,
    );
    expect(screen.getByText("The documents")).toBeInTheDocument();
  });

  it("draws its screen untouched while nothing throws", () => {
    render(
      <ScreenGuard route="tests">
        <Broken bad={false} />
      </ScreenGuard>,
    );
    expect(screen.getByText("The documents")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
  });
});
