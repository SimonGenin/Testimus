// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Lightbox } from "../../../../../src/ui/screens/tests/Lightbox.tsx";

beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const box = (over: { index?: number; names?: string[] } = {}) => {
  const onIndex = vi.fn();
  const onClose = vi.fn();
  const names = over.names ?? ["a.png", "b.png", "c.png"];
  const r = render(
    <Lightbox
      names={names}
      urls={names.map((n) => `/files/${n}`)}
      index={over.index ?? 0}
      step={4}
      onIndex={onIndex}
      onClose={onClose}
    />,
  );
  return { ...r, onIndex, onClose, pic: () => screen.getByRole("img") as HTMLImageElement };
};

const zoomText = () => screen.getByText(/^\d+ %$/).textContent;
const key = (k: string) => fireEvent.keyDown(screen.getByRole("img"), { key: k });

describe("Lightbox", () => {
  it("shows the picture, its name, the step and its place", () => {
    const { pic } = box({ index: 1 });
    expect(screen.getByRole("dialog", { name: "b.png" })).toBeInTheDocument();
    expect(pic()).toHaveAttribute("src", "/files/b.png");
    expect(screen.getByText("Step 4")).toBeInTheDocument();
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(zoomText()).toBe("100 %");
  });

  it("says where the picture sits and its size once loaded, in the head; the foot says the keys", () => {
    render(
      <Lightbox
        names={["fig.png"]}
        urls={["/fig"]}
        index={0}
        step={1}
        column="Expected Result"
        onIndex={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const pic = screen.getByRole("img") as HTMLImageElement;
    Object.defineProperty(pic, "naturalWidth", { value: 320 });
    Object.defineProperty(pic, "naturalHeight", { value: 160 });
    fireEvent.load(pic);
    expect(screen.getByText("Step 1 · Expected Result · 320 × 160")).toBeInTheDocument();
    expect(screen.getByText(/0 or double-click fits · Esc closes/)).toBeInTheDocument();
    expect(screen.getByText("1 of 1")).toBeInTheDocument();
  });

  it("moves with the arrows, wrapping around, and closes on Escape", () => {
    const { onIndex, onClose } = box();
    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(onIndex).toHaveBeenLastCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(onIndex).toHaveBeenLastCalledWith(1);
    key("ArrowLeft");
    expect(onIndex).toHaveBeenLastCalledWith(2);
    key("ArrowRight");
    expect(onIndex).toHaveBeenLastCalledWith(1);
    key("Escape");
    expect(onClose).toHaveBeenCalledTimes(1);
    key("q");
    expect(onIndex).toHaveBeenCalledTimes(4);
  });

  it("zooms with the buttons and the keys and resets to fit", () => {
    box();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(zoomText()).toBe("125 %");
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(zoomText()).toBe("100 %");
    key("+");
    key("=");
    expect(zoomText()).toBe("156 %");
    key("-");
    expect(zoomText()).toBe("125 %");
    key("0");
    expect(zoomText()).toBe("100 %");
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    fireEvent.click(screen.getByRole("button", { name: /^Fit/ }));
    expect(zoomText()).toBe("100 %");
  });

  it("zooms around the pointer with the wheel and pans by dragging", () => {
    const { pic } = box();
    const stage = pic().parentElement as HTMLElement;
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 200,
      height: 100,
    } as DOMRect);
    const wheel = new WheelEvent("wheel", { deltaY: -400 * Math.log(2), clientX: 150, clientY: 50, cancelable: true });
    act(() => void stage.dispatchEvent(wheel));
    expect(wheel.defaultPrevented).toBe(true);
    expect(zoomText()).toBe("200 %");
    expect(pic().style.transform).toBe("translate(-50px, 0px) scale(2)");
    fireEvent.pointerMove(pic(), { clientX: 10, clientY: 10 });
    expect(pic().style.transform).toBe("translate(-50px, 0px) scale(2)");
    fireEvent.pointerDown(pic(), { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(pic(), { clientX: 30, clientY: 15 });
    expect(pic().style.transform).toBe("translate(-30px, 5px) scale(2)");
    fireEvent.pointerUp(pic());
    fireEvent.pointerMove(pic(), { clientX: 90, clientY: 90 });
    expect(pic().style.transform).toBe("translate(-30px, 5px) scale(2)");
    fireEvent.pointerDown(pic(), { clientX: 0, clientY: 0, pointerId: 1 });
    fireEvent.pointerCancel(pic());
    fireEvent.pointerMove(pic(), { clientX: 90, clientY: 90 });
    expect(pic().style.transform).toBe("translate(-30px, 5px) scale(2)");
    fireEvent.doubleClick(pic());
    expect(zoomText()).toBe("100 %");
  });

  it("resets the view when the picture changes", () => {
    const { rerender, onIndex, onClose } = box();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    rerender(
      <Lightbox
        names={["a.png", "b.png"]}
        urls={["/a", "/b"]}
        index={1}
        step={4}
        onIndex={onIndex}
        onClose={onClose}
      />,
    );
    expect(zoomText()).toBe("100 %");
  });

  it("closes on a click outside the picture and its bars only", () => {
    const { onClose, pic } = box({ names: ["only.png"] });
    expect(screen.getByRole("button", { name: "Next image" })).toBeDisabled();
    fireEvent.mouseDown(pic());
    fireEvent.mouseDown(screen.getByText("Step 4"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
