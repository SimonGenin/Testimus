// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../../../../src/ui/components/ui/Button.tsx";
import { Popover } from "../../../../src/ui/components/ui/Popover.tsx";

afterEach(cleanup);

const cls = (el: Element) => el.getAttribute("class") ?? "";

function Ask(props: Partial<Parameters<typeof Popover>[0]>) {
  return (
    <>
      <Popover
        trigger={<Button variant="claude-quiet" icon="claude" label="Ask Claude" />}
        title="Ask Claude · Step 2"
        icon="claude"
        foot="Runs in the dock with this test's contexts"
        {...props}
      >
        <Button label="Rephrase in house style" />
        <Button label="Add the negative path" />
      </Popover>
      <Button label="Elsewhere" />
    </>
  );
}

function Controlled({ changes }: { changes: boolean[] }) {
  const [open, setOpen] = useState(true);
  return (
    <Popover
      trigger={<Button label="Activity" onClick={() => changes.push(open)} />}
      title="Activity"
      open={open}
      onOpenChange={(v) => {
        changes.push(v);
        setOpen(v);
      }}
      width="sm"
      align="start"
    >
      Nothing running.
    </Popover>
  );
}

describe("Popover", () => {
  it("opens as a non-modal dialog named by its title, with the focus on its first control", async () => {
    const user = userEvent.setup();
    render(<Ask />);
    const button = screen.getByRole("button", { name: "Ask Claude" });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    const dialog = screen.getByRole("dialog", { name: "Ask Claude · Step 2" });
    expect(dialog).not.toHaveAttribute("aria-modal");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", dialog.id);
    expect(screen.getByRole("button", { name: "Rephrase in house style" })).toHaveFocus();
    expect(dialog).toHaveTextContent("Runs in the dock with this test's contexts");
    await user.keyboard("{Tab}");
    expect(screen.getByRole("button", { name: "Add the negative path" })).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Escape and the close button shut it and give the focus back to the trigger", async () => {
    const user = userEvent.setup();
    render(<Ask />);
    const button = screen.getByRole("button", { name: "Ask Claude" });
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
    await user.click(button);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("a press outside or the focus leaving shuts it; a press inside or on the trigger does not reopen it", async () => {
    const user = userEvent.setup();
    render(<Ask />);
    const button = screen.getByRole("button", { name: "Ask Claude" });
    await user.click(button);
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(button);
    fireEvent.focusOut(screen.getByRole("button", { name: "Rephrase in house style" }), { relatedTarget: null });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    act(() => screen.getByRole("button", { name: "Elsewhere" }).focus());
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(button);
    await user.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("can be controlled, and focuses itself when it holds nothing to focus", async () => {
    const user = userEvent.setup();
    const changes: boolean[] = [];
    render(<Controlled changes={changes} />);
    const dialog = screen.getByRole("dialog", { name: "Activity" });
    expect(dialog).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(changes).toEqual([false]);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Activity" }));
    expect(changes).toEqual([false, false, true]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has widths, a flush body, and in the catalogue is drawn open without taking the focus", () => {
    const onClick = vi.fn();
    const looks = new Set<string>();
    for (const width of ["auto", "sm", "md"] as const) {
      render(
        <Popover trigger={<Button label={`w ${width}`} />} title={`W ${width}`} width={width} debugState="open">
          Body
        </Popover>,
      );
      looks.add(cls(screen.getByRole("dialog", { name: `W ${width}` })));
    }
    expect(looks.size).toBe(3);
    render(
      <Popover trigger={<Button label="Flush" onClick={onClick} />} title="Flush" flush debugState="open" align="start">
        <span>Edge to edge</span>
      </Popover>,
    );
    render(
      <Popover trigger={<Button label="Padded" />} title="Padded" debugState="open">
        <span>Padded body</span>
      </Popover>,
    );
    expect(cls(screen.getByText("Edge to edge").parentElement as Element)).not.toBe(
      cls(screen.getByText("Padded body").parentElement as Element),
    );
    expect(document.body).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Flush" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "Flush" })).toBeInTheDocument();
  });

  it("without a head is still named by its title, and Escape still closes it", async () => {
    const user = userEvent.setup();
    render(<Ask head={false} title="Add context" />);
    await user.click(screen.getByRole("button", { name: "Ask Claude" }));
    const dialog = screen.getByRole("dialog", { name: "Add context" });
    expect(dialog.querySelector("h2")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Ask Claude" })).toHaveFocus();
  });

  it("is never taller than the room on its side of the trigger: its body scrolls", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(5000);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 40,
      bottom: 68,
      left: 10,
      right: 38,
      width: 28,
      height: 28,
      x: 10,
      y: 40,
    } as DOMRect);
    render(<Ask align="start" />);
    await user.click(screen.getByRole("button", { name: "Ask Claude" }));
    const dialog = screen.getByRole("dialog", { name: "Ask Claude · Step 2" });
    expect(dialog.style.maxHeight).toBe(`${window.innerHeight - 68 - 16}px`);
    vi.restoreAllMocks();
  });

  it("at the window's right edge, a start popover slides back in instead of jumping to the trigger's other edge", async () => {
    const user = userEvent.setup();
    const box = (left: number) =>
      ({ top: 100, bottom: 128, left, right: left + 28, width: 28, height: 28, x: left, y: 100 }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(200);
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(440);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => box(window.innerWidth - 300));
    render(<Ask align="start" />);
    await user.click(screen.getByRole("button", { name: "Ask Claude" }));
    const dialog = screen.getByRole("dialog", { name: "Ask Claude · Step 2" });
    expect(dialog.style.left).toBe(`${window.innerWidth - 440 - 8}px`);
    expect(dialog.style.right).toBe("");
    vi.restoreAllMocks();
  });
});
