// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DragEdge } from "../../../../src/ui/components/legacy/index.ts";
import { useSideWidth } from "../../../../src/ui/lib/sideWidth.ts";

function Bars() {
  const [leftW, leftEdge] = useSideWidth("testimus.sidebarWidth", 200, 400, "before");
  const [rightW, rightEdge] = useSideWidth("testimus.sourceWidth", 300, 600, "after");
  return (
    <div>
      <aside data-testid="left" style={{ width: leftW ?? undefined }} />
      <DragEdge label="Resize left" {...leftEdge} />
      <main />
      <DragEdge label="Resize right" {...rightEdge} />
      <aside data-testid="right" style={{ width: rightW ?? undefined }} />
    </div>
  );
}

const drag = (name: string, dx: number) => {
  const edge = screen.getByRole("separator", { name });
  fireEvent.pointerDown(edge, { clientX: 0 });
  fireEvent.pointerMove(edge, { clientX: dx });
  fireEvent.pointerUp(edge);
  return edge;
};

describe("useSideWidth", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("widens a left bar when dragged right and a right bar when dragged left, within its bounds", () => {
    render(<Bars />);
    drag("Resize left", 250);
    expect(screen.getByTestId("left").style.width).toBe("250px");
    drag("Resize left", 900);
    expect(screen.getByTestId("left").style.width).toBe("400px");
    drag("Resize right", -450);
    expect(screen.getByTestId("right").style.width).toBe("450px");
    drag("Resize right", 100);
    expect(screen.getByTestId("right").style.width).toBe("300px");
    expect(localStorage.getItem("testimus.sidebarWidth")).toBe("400");
    expect(localStorage.getItem("testimus.sourceWidth")).toBe("300");
  });

  it("shows the width while dragging, and a release without a move keeps the saved one", () => {
    localStorage.setItem("testimus.sidebarWidth", "320");
    render(<Bars />);
    const edge = screen.getByRole("separator", { name: "Resize left" });
    fireEvent.pointerDown(edge, { clientX: 0 });
    fireEvent.pointerMove(edge, { clientX: 260 });
    expect(screen.getByTestId("left").style.width).toBe("260px");
    expect(localStorage.getItem("testimus.sidebarWidth")).toBe("320");
    fireEvent.pointerUp(edge);
    fireEvent.pointerDown(edge, { clientX: 0 });
    fireEvent.pointerUp(edge);
    expect(localStorage.getItem("testimus.sidebarWidth")).toBe("260");
  });

  it("ignores a saved width out of bounds, and double-click goes back to the default", () => {
    localStorage.setItem("testimus.sidebarWidth", "9999");
    localStorage.setItem("testimus.sourceWidth", "500");
    render(<Bars />);
    expect(screen.getByTestId("left").style.width).toBe("");
    expect(screen.getByTestId("right").style.width).toBe("500px");
    fireEvent.doubleClick(screen.getByRole("separator", { name: "Resize right" }));
    expect(screen.getByTestId("right").style.width).toBe("");
    expect(localStorage.getItem("testimus.sourceWidth")).toBeNull();
  });
});
