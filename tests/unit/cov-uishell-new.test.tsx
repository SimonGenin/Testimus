// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../src/ui/api.ts";
import { Confirm } from "../../src/ui/components/legacy/index.ts";
import { closeToast } from "../../src/ui/lib/toast.ts";
import { fakeNet } from "./cov-uishell-helpers.tsx";
import { noDesktop } from "./ui-desktop-helpers.tsx";

const ids: number[] = [];

beforeEach(() => fakeNet());

afterEach(() => {
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
  localStorage.clear();
});

describe("Confirm", () => {
  it("asks before a dangerous action, saying what is lost", () => {
    const yes = vi.fn();
    const no = vi.fn();
    const { rerender } = render(
      <Confirm title="Delete the test" confirm="Delete" danger loss="3 steps" onConfirm={yes} onClose={no}>
        <p>LFRPS12-1</p>
      </Confirm>,
    );
    expect(screen.getByRole("dialog", { name: "Delete the test" })).toBeInTheDocument();
    expect(screen.getByText("3 steps")).toHaveClass("loss");
    expect(screen.getByRole("button", { name: "Delete" })).toHaveClass("btn-danger");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(yes).toHaveBeenCalled();
    expect(no).toHaveBeenCalled();
    rerender(
      <Confirm title="Go" confirm="Go" busy onConfirm={yes} onClose={no}>
        <p>x</p>
      </Confirm>,
    );
    expect(screen.getByRole("button", { name: "Go" })).toHaveClass("btn-primary");
    expect(screen.getByRole("button", { name: "Go" })).toBeDisabled();
    expect(document.querySelector(".loss")).toBeNull();
  });
});
