// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChipInput } from "../../src/ui/components/ui/ChipInput.tsx";
import { GrowArea } from "../../src/ui/components/ui/GrowArea.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ChipInput", () => {
  it("adds values on a trailing separator, on Enter and on blur, without duplicates", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ChipInput label="Labels" values={["a"]} onChange={onChange} autoFocus />);
    const input = screen.getByLabelText("Labels");
    fireEvent.change(input, { target: { value: "b" } });
    expect(input).toHaveValue("b");
    fireEvent.change(input, { target: { value: "b; a; c,c," } });
    expect(onChange).toHaveBeenLastCalledWith(["a", "b", "c"]);
    expect(input).toHaveValue("");
    fireEvent.change(input, { target: { value: "d" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["a", "d"]);
    fireEvent.change(input, { target: { value: "e" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(["a", "e"]);
    onChange.mockClear();
    fireEvent.change(input, { target: { value: "a," } });
    expect(onChange).not.toHaveBeenCalled();
    rerender(<ChipInput label="Labels" values={["a", "b"]} onChange={onChange} />);
    fireEvent.keyDown(input, { key: "x" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("drops the last value on Backspace in an empty field and removes a chip", () => {
    const onChange = vi.fn();
    const { rerender } = render(<ChipInput label="Covers" mono values={["K-1", "K-2"]} onChange={onChange} />);
    const input = screen.getByLabelText("Covers");
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).toHaveBeenLastCalledWith(["K-1"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove K-1" }));
    expect(onChange).toHaveBeenLastCalledWith(["K-2"]);
    onChange.mockClear();
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.keyDown(input, { key: "Backspace" });
    rerender(<ChipInput label="Covers" values={[]} onChange={onChange} />);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("is read-only without onChange and renders values through render", () => {
    const { container } = render(
      <ChipInput label="Read" values={["v1"]} className="extra" render={(v) => <b>{v.toUpperCase()}</b>} />,
    );
    expect(screen.queryByLabelText("Read")).toBeNull();
    expect(screen.getByText("V1")).toBeInTheDocument();
    expect(container.querySelector(".chipinput.extra")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Remove v1" })).toBeNull();
  });
});

class FakeRO {
  static last: FakeRO | null = null;
  cb: () => void;
  disconnect = vi.fn();
  constructor(cb: () => void) {
    this.cb = cb;
    FakeRO.last = this;
  }
  observe() {}
}

describe("GrowArea", () => {
  it("grows to its content, pinning the width while it measures", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 120 } as DOMRect);
    const seen: string[] = [];
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      seen.push(`${this.style.width} ${this.style.flex}`);
      return 40;
    });
    render(<GrowArea aria-label="g" value="hello" onChange={() => {}} />);
    const t = screen.getByLabelText("g") as HTMLTextAreaElement;
    expect(t.style.minHeight).toBe("42px");
    expect(t.style.width).toBe("");
    expect(t.style.flex).toBe("");
    expect(seen).toEqual(["120px 0 0 auto"]);
  });

  it("does not measure without a value", () => {
    render(<GrowArea aria-label="g" value={undefined as unknown as string} />);
    expect((screen.getByLabelText("g") as HTMLTextAreaElement).style.minHeight).toBe("");
  });

  it("regrows when its width changes and when fonts load, and stops on unmount", async () => {
    vi.stubGlobal("ResizeObserver", FakeRO);
    let fontsReady: () => void = () => {};
    const fonts = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      ready: new Promise<void>((r) => (fontsReady = r)),
    };
    Object.defineProperty(document, "fonts", { value: fonts, configurable: true });
    const { unmount } = render(<GrowArea aria-label="g" value="" onChange={() => {}} />);
    const t = screen.getByLabelText("g") as HTMLTextAreaElement;
    expect(fonts.addEventListener).toHaveBeenCalledWith("loadingdone", expect.any(Function));
    t.style.minHeight = "";
    FakeRO.last?.cb();
    expect(t.style.minHeight).toBe("");
    Object.defineProperty(t, "clientWidth", { value: 300, configurable: true });
    FakeRO.last?.cb();
    expect(t.style.minHeight).toBe("2px");
    t.style.minHeight = "";
    await act(async () => {
      fontsReady();
      await fonts.ready;
    });
    expect(t.style.minHeight).toBe("2px");
    unmount();
    expect(FakeRO.last?.disconnect).toHaveBeenCalled();
    expect(fonts.removeEventListener).toHaveBeenCalledWith("loadingdone", expect.any(Function));
    Object.defineProperty(document, "fonts", { value: undefined, configurable: true });
  });

  it("copes without fonts support", () => {
    vi.stubGlobal("ResizeObserver", FakeRO);
    Object.defineProperty(document, "fonts", { value: undefined, configurable: true });
    const { unmount } = render(<GrowArea aria-label="g" value="x" onChange={() => {}} />);
    unmount();
    expect(FakeRO.last?.disconnect).toHaveBeenCalled();
  });
});
