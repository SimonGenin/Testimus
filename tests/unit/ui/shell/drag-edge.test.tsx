// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DragEdge } from "../../../../src/ui/components/legacy/DragEdge.tsx";

afterEach(cleanup);

describe("DragEdge", () => {
  const pointer = (type: string, el: Element, clientX: number) =>
    fireEvent(el, Object.assign(new MouseEvent(type, { bubbles: true, clientX }), { pointerId: 1 }));

  it("drags a width from the start width, commits once and resets on double-click", () => {
    const panel = document.createElement("div");
    panel.getBoundingClientRect = () => ({ width: 300 }) as DOMRect;
    const onWidth = vi.fn();
    const onCommit = vi.fn();
    const onReset = vi.fn();
    const width = vi.fn((dx: number, w: number) => w + dx + 0.4);
    render(
      <DragEdge
        className="edge"
        label="Resize the list"
        target={() => panel}
        width={width}
        onWidth={onWidth}
        onCommit={onCommit}
        onReset={onReset}
      />,
    );
    const edge = screen.getByRole("separator", { name: "Resize the list" });
    expect(edge).toHaveAttribute("title", "Resize the list — double-click to reset");
    pointer("pointermove", edge, 50);
    expect(onWidth).not.toHaveBeenCalled();
    const capture = vi.fn();
    (edge as HTMLElement & { setPointerCapture: (id: number) => void }).setPointerCapture = capture;
    pointer("pointerdown", edge, 100);
    expect(capture).toHaveBeenCalled();
    expect(edge).toHaveClass("is-dragging", "edge");
    pointer("pointermove", edge, 140);
    expect(width).toHaveBeenCalledWith(40, 300, panel);
    expect(onWidth).toHaveBeenCalledWith(340);
    pointer("pointerup", edge, 140);
    pointer("lostpointercapture", edge, 140);
    pointer("pointercancel", edge, 140);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(edge).not.toHaveClass("is-dragging");
    delete (edge as Partial<HTMLElement & { setPointerCapture: unknown }>).setPointerCapture;
    pointer("pointerdown", edge, 10);
    pointer("pointercancel", edge, 10);
    expect(onCommit).toHaveBeenCalledTimes(2);
    fireEvent.doubleClick(edge);
    expect(onReset).toHaveBeenCalled();
  });
});
