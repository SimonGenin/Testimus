// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { ConnectClaude } from "../../../../src/ui/components/claude/ConnectClaude.tsx";
import { cap, ModelPicker } from "../../../../src/ui/components/claude/ModelPicker.tsx";
import { OnTopToggle } from "../../../../src/ui/components/shell/OnTopToggle.tsx";
import { Toaster } from "../../../../src/ui/components/ui/Toast.tsx";
import { readAlwaysOnTop, restoreAlwaysOnTop, setAlwaysOnTop } from "../../../../src/ui/lib/desktop.ts";
import { closeToast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { choose, openList } from "../../helpers/select.ts";
import { dataWrapper, fakeNet } from "../../helpers/ui-data.tsx";
import { fakeDesktop, noDesktop } from "../../helpers/ui-desktop.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

let ids: number[] = [];
function Probe() {
  ids = useToasts().map((t) => t.id);
  return <Toaster />;
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
    expect(localStorage.getItem("testimus.alwaysOnTop")).toBe("1");
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
  it("picks a listed model; one saved before that the list does not know is shown, never typed in", () => {
    const change = vi.fn();
    const { rerender } = render(<ModelPicker value="sonnet" onChange={change} />);
    const select = screen.getByRole("combobox", { name: "Model" });
    expect(
      within(openList(select))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["fable", "opus", "sonnet", "haiku"]);
    choose(select, "opus");
    expect(change).toHaveBeenLastCalledWith("opus");
    rerender(<ModelPicker value="other-1" onChange={change} />);
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("other-1");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("is labelled by its own label when it has an id", () => {
    render(
      <>
        <label htmlFor="m">Default model</label>
        <ModelPicker id="m" value="mine" onChange={() => {}} />
      </>,
    );
    expect(screen.getByLabelText("Default model")).toHaveTextContent("mine");
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
    expect(screen.queryByRole("button", { name: "Open the system check" })).toBeNull();
  });

  it("says Claude is absent once per look: the dock's badge and « What Testimus saw », a card's one line, Settings' none", () => {
    const status = { installed: false, signedIn: null, detail: "spawn claude ENOENT" };
    const { rerender } = render(<ConnectClaude look="dock" status={status} checking={false} onCheck={() => {}} />);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(screen.getByText("What Testimus saw")).toBeInTheDocument();
    expect(screen.getByText("spawn claude ENOENT")).toBeInTheDocument();
    rerender(<ConnectClaude status={status} checking={false} onCheck={() => {}} />);
    expect(screen.queryByText("Not connected")).toBeNull();
    expect(screen.queryByText("What Testimus saw")).toBeNull();
    expect(screen.getByText("spawn claude ENOENT")).toBeInTheDocument();
    expect(screen.getByText("Install Claude Code")).toBeInTheDocument();
    rerender(<ConnectClaude look="panel" status={status} checking={false} onCheck={() => {}} />);
    expect(screen.queryByText("Not connected")).toBeNull();
    expect(screen.queryByText("spawn claude ENOENT")).toBeNull();
    expect(screen.getByRole("heading", { name: "Claude isn't installed on this PC yet" })).toBeInTheDocument();
  });
});
