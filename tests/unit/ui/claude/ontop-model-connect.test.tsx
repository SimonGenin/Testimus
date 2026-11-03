// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { ConnectClaude } from "../../../../src/ui/components/claude/ConnectClaude.tsx";
import { cap, ModelPicker } from "../../../../src/ui/components/claude/ModelPicker.tsx";
import { OnTopToggle } from "../../../../src/ui/components/claude/OnTopToggle.tsx";
import { Toasts } from "../../../../src/ui/components/legacy/index.ts";
import { readAlwaysOnTop, restoreAlwaysOnTop, setAlwaysOnTop } from "../../../../src/ui/lib/desktop.ts";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { dataWrapper, fakeNet } from "../../cov-uishell-helpers.tsx";
import { fakeDesktop, noDesktop } from "../../ui-desktop-helpers.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

let ids: number[] = [];
function Probe() {
  ids = useToasts().map((t) => t.id);
  return <Toasts />;
}

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

describe("always on top", () => {
  it("remembers the choice, and tells the window only in the desktop shell", async () => {
    const seen = vi.fn();
    window.addEventListener("testimus:on-top", (e) => seen((e as CustomEvent).detail));
    expect(readAlwaysOnTop()).toBe(false);
    expect(await setAlwaysOnTop(true)).toBe(false);
    expect(readAlwaysOnTop()).toBe(true);
    expect(seen).toHaveBeenLastCalledWith(true);
    fakeDesktop();
    expect(await setAlwaysOnTop(false)).toBe(false);
    fakeDesktop();
    const set = vi.fn(async (on: boolean) => on);
    (window.testimusDesktop as unknown as { setAlwaysOnTop: typeof set }).setAlwaysOnTop = set;
    expect(await setAlwaysOnTop(true)).toBe(true);
    expect(localStorage.getItem("testimus.alwaysOnTop")).toBe("true");
    set.mockClear();
    restoreAlwaysOnTop();
    expect(set).toHaveBeenCalledWith(true);
    localStorage.setItem("testimus.alwaysOnTop", "false");
    set.mockClear();
    restoreAlwaysOnTop();
    expect(set).not.toHaveBeenCalled();
    noDesktop();
    set.mockClear();
    localStorage.setItem("testimus.alwaysOnTop", "true");
    restoreAlwaysOnTop();
    expect(set).not.toHaveBeenCalled();
  });

  it("says when the window refuses, and reads false from a storage that throws", async () => {
    fakeDesktop();
    (window.testimusDesktop as unknown as { setAlwaysOnTop: () => Promise<boolean> }).setAlwaysOnTop = async () => {
      throw new Error("no window");
    };
    render(<Probe />);
    await act(async () => {
      expect(await setAlwaysOnTop(true)).toBe(false);
    });
    expect(screen.getByText("Could not change always on top")).toBeInTheDocument();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readAlwaysOnTop()).toBe(false);
  });

  it("is a pin button only in the desktop shell, following the choice made elsewhere", async () => {
    const { container } = render(<OnTopToggle />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    fakeDesktop();
    const set = vi.fn(async (on: boolean) => on);
    (window.testimusDesktop as unknown as { setAlwaysOnTop: typeof set }).setAlwaysOnTop = set;
    render(<OnTopToggle />);
    const pin = screen.getByRole("button", { name: "Always on top" });
    expect(pin).toHaveAttribute("aria-pressed", "false");
    expect(pin).toHaveAccessibleDescription("Always on top");
    fireEvent.click(pin);
    await waitFor(() => expect(set).toHaveBeenCalledWith(true));
    expect(pin).toHaveAttribute("aria-pressed", "true");
    act(() => {
      localStorage.setItem("testimus.alwaysOnTop", "false");
      window.dispatchEvent(new CustomEvent("testimus:on-top", { detail: false }));
    });
    expect(pin).toHaveAttribute("aria-pressed", "false");
  });
});

describe("ModelPicker", () => {
  it("picks a listed model, or a typed one handed over on Enter or blur only", () => {
    const change = vi.fn();
    const { rerender } = render(<ModelPicker value="sonnet" className="c" onChange={change} />);
    const select = screen.getByRole("combobox", { name: "Model" });
    expect(screen.getByRole("option", { name: "Fable" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "opus" } });
    expect(change).toHaveBeenLastCalledWith("opus");
    fireEvent.change(select, { target: { value: "custom" } });
    const box = screen.getByRole("textbox", { name: "Custom model" });
    expect(box).toHaveValue("");
    fireEvent.blur(box);
    fireEvent.change(box, { target: { value: "bad name!" } });
    expect(box).toHaveAttribute("aria-invalid", "true");
    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.change(box, { target: { value: "claude-x-1[1m]" } });
    expect(box).not.toHaveAttribute("aria-invalid");
    fireEvent.keyDown(box, { key: "a" });
    expect(change).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(change).toHaveBeenLastCalledWith("claude-x-1[1m]");
    rerender(<ModelPicker value="claude-x-1[1m]" className="c" onChange={change} />);
    fireEvent.blur(screen.getByRole("textbox", { name: "Custom model" }));
    expect(change).toHaveBeenCalledTimes(2);
    rerender(<ModelPicker value="haiku" className="c" onChange={change} />);
    expect(screen.queryByRole("textbox", { name: "Custom model" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("haiku");
    rerender(<ModelPicker value="other-1" className="c" onChange={change} />);
    expect(screen.getByRole("textbox", { name: "Custom model" })).toHaveValue("other-1");
  });

  it("is labelled by its own label when it has an id", () => {
    render(
      <>
        <label htmlFor="m">Default model</label>
        <ModelPicker id="m" value="mine" className="c" onChange={() => {}} />
      </>,
    );
    expect(screen.getByLabelText("Default model")).toHaveValue("custom");
    expect(cap("")).toBe("");
    expect(cap("opus")).toBe("Opus");
  });
});

describe("ConnectClaude, the optional buttons", () => {
  it("offers to set the path, and leaves the system check out when not given", () => {
    const setPath = vi.fn();
    render(
      <ConnectClaude
        status={{ installed: false, signedIn: null }}
        checking={false}
        onCheck={() => {}}
        onSetPath={setPath}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Set the path myself…" }));
    expect(setPath).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Open system check" })).toBeNull();
  });
});
