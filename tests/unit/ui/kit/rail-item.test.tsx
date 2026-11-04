// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../../../../src/ui/components/ui/Button.tsx";
import { ClaudeBlock } from "../../../../src/ui/components/ui/ClaudeBlock.tsx";
import { ListItem } from "../../../../src/ui/components/ui/ListItem.tsx";
import { RailItem } from "../../../../src/ui/components/ui/RailItem.tsx";
import { Select } from "../../../../src/ui/components/ui/Select.tsx";
import { dismissToast, toast, useToasts } from "../../../../src/ui/components/ui/Toast.tsx";
import { onPrefsChange, writePref } from "../../../../src/ui/lib/prefs.ts";

afterEach(cleanup);
const cls = (el: Element | null) => el?.getAttribute("class") ?? "";

describe("RailItem", () => {
  it("is a button with a short word and a longer name, current when its screen shows", () => {
    const onClick = vi.fn();
    render(<RailItem icon="sun" label="System" ariaLabel="Theme: System. Switch to Light" onClick={onClick} />);
    const b = screen.getByRole("button", { name: "Theme: System. Switch to Light" });
    expect(b).toHaveTextContent("System");
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalled();
    render(<RailItem icon="tests" label="Tests" current />);
    expect(screen.getByRole("button", { name: "Tests" })).toHaveAttribute("aria-current", "page");
  });

  it("is a link with a destination, says how many wait, and opens a menu", () => {
    render(<RailItem icon="review" label="Review" href="#/review" count={3} />);
    const a = screen.getByRole("link", { name: "Review, 3" });
    expect(a).toHaveAttribute("href", "#/review");
    expect(a).toHaveTextContent("3");
    render(<RailItem avatar="RS" label="LFRPS12" mono popup={{ kind: "menu", open: true, controls: "pm" }} />);
    const p = screen.getByRole("button", { name: /LFRPS12/ });
    expect(p).toHaveAttribute("aria-haspopup", "menu");
    expect(p).toHaveAttribute("aria-expanded", "true");
    expect(p).toHaveTextContent("RS");
  });

  it("shows a state dot, and its forced states for the catalogue", () => {
    const looks = new Set<string>();
    for (const [name, p] of [
      ["plain", {}],
      ["current", { current: true }],
      ["hover", { debugState: "hover" as const }],
      ["focus", { debugState: "focus" as const }],
    ] as const) {
      render(<RailItem icon="jobs" label={name} {...p} />);
      looks.add(cls(screen.getByRole("button", { name })));
    }
    expect(looks.size).toBe(4);
    render(<RailItem dot="success" label="All good" ariaLabel="System: All good. Open the system check" />);
    expect(screen.getByRole("button", { name: /^System: All good/ })).toHaveTextContent("All good");
  });
});

describe("options asked by the screens", () => {
  it("a Button's countdown shows but stays out of its name", () => {
    render(<Button label="Undo" countdown={5} />);
    const b = screen.getByRole("button", { name: "Undo" });
    expect(b).toHaveTextContent("Undo· 5 s");
  });

  it("a ListItem carries an id for aria-activedescendant", () => {
    render(
      <ul>
        <ListItem id="opt-3" title="Third" />
      </ul>,
    );
    expect(screen.getByText("Third").closest("li")).toHaveAttribute("id", "opt-3");
  });

  it("a Select takes the id an outside label points at", () => {
    render(
      <>
        <label htmlFor="set-model">Default model</label>
        <Select id="set-model" label="Model" value="a" options={[{ value: "a", label: "A" }]} onChange={() => {}} />
      </>,
    );
    expect(screen.getByLabelText("Default model")).toHaveAttribute("id", "set-model");
  });

  it("a ClaudeBlock takes its own add-context trigger and content inside its frame", () => {
    render(
      <ClaudeBlock
        ariaLabel="Prompt"
        value=""
        contexts={[{ id: "g", label: "Glossaire", on: true }]}
        onAddContext={() => {}}
        addContext={<Button size="sm" label="Pick contexts" />}
        onSubmit={() => {}}
      >
        <span>Additional note</span>
      </ClaudeBlock>,
    );
    expect(screen.getByRole("button", { name: "Pick contexts" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add context" })).toBeNull();
    expect(screen.getByText("Additional note")).toBeInTheDocument();
  });

  it("the live toasts can be read outside the stack", () => {
    const { result } = renderHook(() => useToasts());
    let id = 0;
    act(() => {
      id = toast({ title: "Pulled", tone: "success" });
    });
    expect(result.current.map((t) => t.title)).toContain("Pulled");
    act(() => dismissToast(id));
    expect(result.current.map((t) => t.title)).not.toContain("Pulled");
  });

  it("a preference change is told outside React", () => {
    const fn = vi.fn();
    const off = onPrefsChange(fn);
    writePref("jobsGroup", false);
    expect(fn).toHaveBeenCalled();
    off();
    writePref("jobsGroup", true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("Chip removeLabel", () => {
  it("names the remove button by what it does", async () => {
    const { Chip } = await import("../../../../src/ui/components/ui/Chip.tsx");
    const onRemove = vi.fn();
    render(<Chip label="Glossaire" onRemove={onRemove} removeLabel="Leave Glossaire out of this run" />);
    fireEvent.click(screen.getByRole("button", { name: "Leave Glossaire out of this run" }));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe("Modal confirm disabled", () => {
  it("keeps the verb waiting while Cancel stays", async () => {
    const { Modal } = await import("../../../../src/ui/components/ui/Modal.tsx");
    const onConfirm = vi.fn();
    render(
      <Modal
        title="Delete the document?"
        onClose={() => {}}
        confirm={{ verb: "Delete", danger: true, onConfirm, disabled: "Reading the plan" }}
      >
        Its folder and its index rows go.
      </Modal>,
    );
    expect(screen.getByRole("button", { name: "Delete" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});
