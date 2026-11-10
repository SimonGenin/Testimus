// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeBlock } from "../../../../src/ui/components/ui/ClaudeBlock.tsx";
import { clearDrafts } from "../../../../src/ui/lib/data/autosave.ts";
import { createQueryClient, type Key } from "../../../../src/ui/lib/data/query.ts";
import { noRunChoice, pickRun, runChoice } from "../../helpers/run-choice.ts";
import { choose } from "../../helpers/select.ts";

const client = createQueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
let n = 0;
const k = (): Key => ["/p", "dock", { n: ++n }];

afterEach(() => {
  cleanup();
  clearDrafts();
  vi.useRealTimers();
});

const models = {
  value: "opus",
  options: [
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
  ],
};
const efforts = {
  value: "high",
  options: [
    { value: "low", label: "Low" },
    { value: "high", label: "High" },
  ],
};

describe("ClaudeBlock", () => {
  it("is the Text component: the box, sent by Ctrl+Enter with the run's choices, then emptied", () => {
    const onSubmit = vi.fn();
    const onModel = vi.fn();
    render(
      <ClaudeBlock
        ariaLabel="Ask Claude"
        value=""
        placeholder="Ask about this test"
        scope="Whole test"
        model={{ ...models, onChange: onModel }}
        effort={{ ...efforts, onChange: () => {} }}
        onSubmit={onSubmit}
      />,
    );
    const box = screen.getByRole("textbox", { name: "Ask Claude" });
    expect(box.tagName).toBe("TEXTAREA");
    expect(screen.getByText("Whole test")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    fireEvent.change(box, { target: { value: "Add a negative step" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledWith("Add a negative step", { model: "opus", effort: "high" });
    expect(box).toHaveValue("");
    expect(runChoice()).toHaveAccessibleName("Opus · High");
    pickRun("Sonnet");
    expect(onModel).toHaveBeenCalledWith("sonnet");
  });

  it("what goes with the run is one Context button: how many pieces go, and its owner's dialog on a click", () => {
    const onOpen = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <ClaudeBlock ariaLabel="Prompt" value="Go" context={{ count: 7, onOpen }} onSubmit={onSubmit} />,
    );
    const context = screen.getByRole("button", { name: /^Context/ });
    expect(context).toHaveTextContent(/^Context7$/);
    expect(context.querySelector("[data-icon]")).toHaveAttribute("data-icon", "context");
    expect(screen.queryByRole("button", { name: "Add context" })).toBeNull();
    fireEvent.click(context);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(<ClaudeBlock ariaLabel="Prompt" value="Go" context={{ onOpen }} onSubmit={onSubmit} />);
    expect(screen.getByRole("button", { name: /^Context/ })).toHaveTextContent(/^Context$/);
    rerender(<ClaudeBlock ariaLabel="Prompt" value="Go" onSubmit={onSubmit} />);
    expect(screen.queryByRole("button", { name: /^Context/ })).toBeNull();
  });

  it("the Context button says when this run's context was changed, with or without a count", () => {
    const plain = render(
      <ClaudeBlock ariaLabel="Prompt" value="" context={{ count: 7, onOpen: () => {} }} onSubmit={() => {}} />,
    );
    const quiet = screen.getByRole("button", { name: /^Context/ }).getAttribute("class");
    plain.unmount();
    const { rerender } = render(
      <ClaudeBlock
        ariaLabel="Prompt"
        value=""
        context={{ count: 6, changed: true, onOpen: () => {} }}
        onSubmit={() => {}}
      />,
    );
    const changed = screen.getByRole("button", { name: /^Context/ });
    expect(changed).toHaveTextContent(/^Context6 · changed$/);
    expect(changed.getAttribute("class")).not.toBe(quiet);
    rerender(
      <ClaudeBlock ariaLabel="Prompt" value="" context={{ changed: true, onOpen: () => {} }} onSubmit={() => {}} />,
    );
    expect(screen.getByRole("button", { name: /^Context/ })).toHaveTextContent(/^Contextchanged$/);
  });

  it("the Context button leaves while Claude works, and is off with a disabled box", () => {
    const onOpen = vi.fn();
    const { rerender } = render(
      <ClaudeBlock ariaLabel="Prompt" value="Go" running={3} context={{ count: 7, onOpen }} onSubmit={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /^Context/ })).toBeNull();
    rerender(<ClaudeBlock ariaLabel="Prompt" value="Go" disabled context={{ count: 7, onOpen }} onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: /^Context/ })).toBeDisabled();
  });

  it("Suggestions is a menu in the foot: one picked writes its prompt in the box", () => {
    render(
      <ClaudeBlock
        ariaLabel="Prompt"
        value=""
        quickAsks={[{ label: "Shorten", prompt: "Make every step shorter." }]}
        onSubmit={() => {}}
      />,
    );
    expect(screen.queryByRole("button", { name: "Shorten" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Suggestions" }));
    const item = screen.getByRole("menuitem", { name: /^Shorten/ });
    expect(item).toHaveTextContent("Make every step shorter.");
    fireEvent.click(item);
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("Make every step shorter.");
  });

  it("the scope is a select in the foot, never a chip; another one is chosen, the one chosen is not chosen again", () => {
    const onScope = vi.fn();
    render(
      <ClaudeBlock
        ariaLabel="Prompt"
        value=""
        scopes={[
          { value: "all", label: "All 3 tests" },
          { value: "add", label: "Add tests", hint: "Under this generation" },
        ]}
        scopeValue="all"
        onScope={onScope}
        onSubmit={() => {}}
      />,
    );
    expect(screen.queryByRole("group", { name: "Scope" })).toBeNull();
    const scope = screen.getByRole("combobox", { name: "Scope" });
    expect(scope).toHaveTextContent("All 3 tests");
    choose(scope, "All 3 tests");
    expect(onScope).not.toHaveBeenCalled();
    choose(scope, /^Add tests/);
    expect(onScope).toHaveBeenCalledWith("add");
  });

  it("a suggestion with a scope also sets that scope, and its line says so", () => {
    const onScope = vi.fn();
    render(
      <ClaudeBlock
        ariaLabel="Prompt"
        value=""
        scopes={[
          { value: "all", label: "All 3 tests" },
          { value: "add", label: "Add tests" },
        ]}
        scopeValue="all"
        onScope={onScope}
        quickAsks={[
          { label: "Shorten", prompt: "Make it short." },
          { label: "Cover the skipped items", prompt: "Write them.", scope: "add" },
        ]}
        onSubmit={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Suggestions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Shorten/ }));
    expect(onScope).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Suggestions" }));
    const cover = screen.getByRole("menuitem", { name: /^Cover the skipped items/ });
    expect(cover).toHaveTextContent("Write them. (Add tests)");
    fireEvent.click(cover);
    expect(onScope).toHaveBeenCalledWith("add");
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("Write them.");
  });

  it("sends on Enter when asked, and may start with an empty box", () => {
    const onSubmit = vi.fn();
    render(
      <ClaudeBlock ariaLabel="Track" value="" submit="enter" allowEmpty submitLabel="Ask Claude" onSubmit={onSubmit} />,
    );
    const box = screen.getByRole("textbox", { name: "Track" });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("", { model: undefined, effort: undefined });
    fireEvent.click(screen.getByRole("button", { name: "Ask Claude" }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("while Claude works, is read-only, counts the seconds and offers Cancel", () => {
    const onCancel = vi.fn();
    const onSubmit = vi.fn();
    render(<ClaudeBlock ariaLabel="Prompt" value="Go" running={75} onCancel={onCancel} onSubmit={onSubmit} />);
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveAttribute("readonly");
    expect(screen.getByText("Claude is working")).toBeInTheDocument();
    expect(screen.getByText("1:15")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Prompt" }), { key: "Enter", ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("without Claude, says why and cannot send", () => {
    render(
      <ClaudeBlock ariaLabel="Prompt" value="x" unavailable="Claude is not connected" onSubmit={() => {}} plain />,
    );
    expect(screen.getAllByText("Claude is not connected").length).toBeGreaterThan(0);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    expect(send).toHaveAccessibleDescription("Claude is not connected");
    expect(screen.getByRole("textbox", { name: "Prompt" })).toBeDisabled();
  });

  it("keeps its draft per key across screens", () => {
    const key = k();
    const { unmount } = render(<ClaudeBlock ariaLabel="Prompt" value="" draftKey={key} onSubmit={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "unsent" } });
    unmount();
    render(<ClaudeBlock ariaLabel="Prompt" value="" draftKey={key} onSubmit={() => {}} />);
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("unsent");
  });

  it("as a note, saves itself like Text and has no send footer", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => undefined);
    render(<ClaudeBlock label="To fix" value="" submit="autosave" save={save} saveKey={k()} />, { wrapper });
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: /To fix/ }), { target: { value: "Step 3 is wrong" } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(save).toHaveBeenCalledWith("Step 3 is wrong", undefined);
  });

  it("a note with a Context keeps that one button in its foot, and still nothing to send", () => {
    const onOpen = vi.fn();
    render(
      <ClaudeBlock label="Note" value="x" onChange={() => {}} submit="autosave" context={{ count: 6, onOpen }} />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: /^Context/ }));
    expect(onOpen).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.queryByText("to send")).toBeNull();
    expect(screen.queryByText("Ctrl+Enter")).toBeNull();
  });

  it("can be controlled by its owner and shows a focus state for the catalogue", () => {
    const onChange = vi.fn();
    const { container } = render(
      <ClaudeBlock ariaLabel="Prompt" value="owned" onChange={onChange} onSubmit={() => {}} debugState="focus" />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), { target: { value: "owned!" } });
    expect(onChange).toHaveBeenCalledWith("owned!");
    render(<ClaudeBlock ariaLabel="Plain" value="" onSubmit={() => {}} />);
    expect(container.firstElementChild?.getAttribute("class")).not.toBe(
      screen.getByRole("textbox", { name: "Plain" }).closest("div[class]")?.parentElement?.getAttribute("class"),
    );
  });
});

describe("ClaudeBlock frameless", () => {
  it("leaves the frame to its container", () => {
    render(<ClaudeBlock ariaLabel="framed" value="" onSubmit={() => {}} />);
    render(<ClaudeBlock ariaLabel="frameless" value="" frameless onSubmit={() => {}} />);
    const frame = (name: string) => {
      let el: HTMLElement | null = screen.getByRole("textbox", { name });
      while (el && !el.querySelector("button")) el = el.parentElement;
      return el?.getAttribute("class");
    };
    expect(frame("framed")).not.toBe(frame("frameless"));
  });
});

describe("ClaudeBlock submit none", () => {
  it("keeps the foot without a send button; Ctrl+Enter still submits", () => {
    const onSubmit = vi.fn();
    render(
      <ClaudeBlock
        ariaLabel="Request"
        value="Tests for § 5.6.6"
        onChange={() => {}}
        submit="none"
        scope="Generate"
        model={{ ...models, onChange: () => {} }}
        onSubmit={onSubmit}
      />,
    );
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.queryByText("to send")).toBeNull();
    expect(screen.getByRole("button", { name: "Opus" })).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Request" }), { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalled();
  });
});

describe("ClaudeBlock foot (design: dock, dock running, dock offline)", () => {
  const full = {
    ariaLabel: "Prompt",
    value: "x",
    scope: "Whole project",
    quickAsks: [{ label: "Shorten", prompt: "Make it short." }],
    model: { ...models, onChange: () => {} },
    effort: { ...efforts, onChange: () => {} },
    onSubmit: () => {},
  };

  it("shows no key beside Send: the shortcut works unseen", () => {
    render(<ClaudeBlock {...full} />);
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.queryByText("Ctrl+Enter")).toBeNull();
    expect(screen.queryByText("to send")).toBeNull();
  });

  it("while Claude works, the foot says so and drops the scope and the choices", () => {
    render(<ClaudeBlock {...full} running={12} onCancel={() => {}} />);
    expect(screen.getByText("Claude is working")).toBeVisible();
    expect(screen.getByText("0:12")).toBeInTheDocument();
    expect(screen.queryByText("Whole project")).toBeNull();
    expect(noRunChoice()).toBeNull();
  });

  it("without Claude, keeps the scope and greyed choices, says why in full and hides the quick asks", () => {
    render(<ClaudeBlock {...full} unavailable="Claude is not connected" />);
    expect(screen.getByText("Whole project")).toBeInTheDocument();
    expect(runChoice()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Suggestions" })).toBeNull();
    expect(screen.getAllByText("Claude is not connected")[0]).toBeInTheDocument();
    expect(screen.queryByText("Ctrl+Enter")).toBeNull();
  });
});
