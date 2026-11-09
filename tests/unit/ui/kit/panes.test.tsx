// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ResizeHandle } from "../../../../src/ui/components/ui/ResizeHandle.tsx";
import { usePaneWidth } from "../../../../src/ui/lib/panes.ts";

const LIMITS = { min: 200, max: 400, initial: 300 };

function Pane({ limits = LIMITS }: { limits?: typeof LIMITS }) {
  const p = usePaneWidth("docsTocWidth", limits);
  return (
    <>
      <div data-testid="pane" data-moved={String(p.moved)} style={{ width: p.width }} />
      <ResizeHandle label="Contents width" {...p.handle} />
    </>
  );
}

const pane = () => screen.getByTestId("pane");
const edge = () => screen.getByRole("separator", { name: "Contents width" });

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("usePaneWidth", () => {
  it("starts at the design's width, not moved, nothing kept", () => {
    render(<Pane />);
    expect(pane().style.width).toBe("300px");
    expect(pane()).toHaveAttribute("data-moved", "false");
    expect(edge()).toHaveAttribute("aria-valuenow", "300");
    expect(edge()).toHaveAttribute("aria-valuemin", "200");
    expect(edge()).toHaveAttribute("aria-valuemax", "400");
    expect(localStorage.getItem("testimus.docsTocWidth")).toBeNull();
  });

  it("follows a drag without writing, keeps the width once the gesture ends", () => {
    render(<Pane />);
    fireEvent.pointerDown(edge(), { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(edge(), { clientX: 150 });
    expect(pane().style.width).toBe("350px");
    expect(pane()).toHaveAttribute("data-moved", "true");
    expect(localStorage.getItem("testimus.docsTocWidth")).toBeNull();
    fireEvent.pointerUp(edge());
    expect(localStorage.getItem("testimus.docsTocWidth")).toBe("350");
    expect(pane().style.width).toBe("350px");
    expect(pane()).toHaveAttribute("data-moved", "true");
  });

  it("starts at a kept width, and a double-click forgets it", () => {
    localStorage.setItem("testimus.docsTocWidth", "400");
    render(<Pane />);
    expect(pane().style.width).toBe("400px");
    expect(pane()).toHaveAttribute("data-moved", "true");
    fireEvent.doubleClick(edge());
    expect(pane().style.width).toBe("300px");
    expect(pane()).toHaveAttribute("data-moved", "false");
    expect(localStorage.getItem("testimus.docsTocWidth")).toBeNull();
  });

  it("keeps a key move, and forgets a width brought back to the design's", () => {
    render(<Pane />);
    fireEvent.keyDown(edge(), { key: "ArrowRight" });
    expect(localStorage.getItem("testimus.docsTocWidth")).toBe("316");
    fireEvent.keyDown(edge(), { key: "ArrowLeft" });
    expect(localStorage.getItem("testimus.docsTocWidth")).toBeNull();
    fireEvent.keyDown(edge(), { key: "End" });
    expect(localStorage.getItem("testimus.docsTocWidth")).toBe("400");
    fireEvent.keyDown(edge(), { key: "Home" });
    expect(localStorage.getItem("testimus.docsTocWidth")).toBeNull();
  });

  it("bounds a kept width to the pane's own limits", () => {
    localStorage.setItem("testimus.docsTocWidth", "400");
    render(<Pane limits={{ min: 240, max: 360, initial: 300 }} />);
    expect(pane().style.width).toBe("360px");
    expect(edge()).toHaveAttribute("aria-valuenow", "360");
    cleanup();
    localStorage.setItem("testimus.docsTocWidth", "250");
    render(<Pane limits={{ min: 280, max: 400, initial: 300 }} />);
    expect(pane().style.width).toBe("280px");
  });

  it("ignores a stored width the preference refuses", () => {
    localStorage.setItem("testimus.docsTocWidth", "9999");
    render(<Pane />);
    expect(pane().style.width).toBe("300px");
    expect(pane()).toHaveAttribute("data-moved", "false");
  });
});
