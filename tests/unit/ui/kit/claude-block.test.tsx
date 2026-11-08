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
        contexts={[
          { id: "glossaire", label: "Glossaire", on: true },
          { id: "old", label: "Old notes", on: false },
        ]}
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
    expect(onSubmit).toHaveBeenCalledWith("Add a negative step", {
      model: "opus",
      effort: "high",
      contexts: ["glossaire"],
    });
    expect(box).toHaveValue("");
    expect(runChoice()).toHaveAccessibleName("Opus · High");
    pickRun("Sonnet");
    expect(onModel).toHaveBeenCalledWith("sonnet");
  });

  it("switches a context off for this run and offers to add one", () => {
    const onContext = vi.fn();
    const onAdd = vi.fn();
    render(
      <ClaudeBlock
        ariaLabel="Prompt"
        value=""
        contexts={[{ id: "g", label: "Glossaire", on: true }]}
        onContext={onContext}
        onAddContext={onAdd}
        onSubmit={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Glossaire" }));
    expect(onContext).toHaveBeenCalledWith("g", false);
    fireEvent.click(screen.getByRole("button", { name: "Add context" }));
    expect(onAdd).toHaveBeenCalled();
  });

  it("puts a quick ask's prompt in the box; typing releases it", () => {
    render(
      <ClaudeBlock
        ariaLabel="Prompt"
        value=""
        quickAsks={[{ label: "Shorten", prompt: "Make every step shorter." }]}
        onSubmit={() => {}}
      />,
    );
    const chip = screen.getByRole("button", { name: "Shorten" });
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("Make every step shorter.");
    fireEvent.change(screen.getByRole("textbox", { name: "Prompt" }), {
      target: { value: "Make every step shorter!" },
    });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(chip);
    fireEvent.click(chip);
    expect(screen.getByRole("textbox", { name: "Prompt" })).toHaveValue("");
  });

  it("offers its scopes as chips, one pressed; another one is chosen, the pressed one is not chosen again", () => {
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
        onSubmit={() => {}}
      />,
    );
    const group = screen.getByRole("group", { name: "Scope" });
    expect(group).toHaveTextContent("Scope");
    expect(screen.getByRole("button", { name: "All 3 tests" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Add tests" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "All 3 tests" }));
    expect(onScope).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Add tests" }));
    expect(onScope).toHaveBeenCalledWith("add");
  });

  it("sends on Enter when asked, and may start with an empty box", () => {
    const onSubmit = vi.fn();
    render(
      <ClaudeBlock ariaLabel="Track" value="" submit="enter" allowEmpty submitLabel="Ask Claude" onSubmit={onSubmit} />,
    );
    expect(screen.getByText("to send")).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: "Track" });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledWith("", { model: undefined, effort: undefined, contexts: [] });
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

  it("shows the Ctrl+Enter key beside Send", () => {
    render(<ClaudeBlock {...full} />);
    expect(screen.getByText("Ctrl+Enter").tagName).toBe("KBD");
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
    expect(screen.queryByRole("button", { name: "Shorten" })).toBeNull();
    expect(screen.getAllByText("Claude is not connected")[0]).toBeInTheDocument();
    expect(screen.queryByText("Ctrl+Enter")).toBeNull();
  });
});
