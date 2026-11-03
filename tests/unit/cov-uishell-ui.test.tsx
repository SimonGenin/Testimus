// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Finding, Review, SyncState } from "../../src/core/types.ts";
import {
  Badge,
  Button,
  Chip,
  ClaudeBadge,
  Field,
  FindingCard,
  Icon,
  IconButton,
  Kbd,
  Menu,
  Modal,
  RequirementChip,
  ReviewBadge,
  Segmented,
  Severity,
  Skeleton,
  SourceChip,
  SyncBadge,
  Tabs,
  Toasts,
} from "../../src/ui/components/ui/index.ts";
import { closeToast, toast, useToasts } from "../../src/ui/lib/toast.ts";

afterEach(cleanup);

let left = -1;
function Left() {
  left = useToasts().length;
  return null;
}

describe("small ui pieces", () => {
  it("renders badges, buttons and keys with their tones", () => {
    render(
      <>
        <Badge>plain</Badge>
        <Badge tone="ok" icon="check" small className="x">
          ok
        </Badge>
        <Button tone="primary" icon="send" kbd="Enter">
          Go
        </Button>
        <Button tone="quiet" size="sm">
          Quiet
        </Button>
        <IconButton icon="close" label="Close it" />
        <IconButton icon="close" label="Other" size="md" title="Custom title" />
        <Kbd>Ctrl K</Kbd>
        <ClaudeBadge />
        <ClaudeBadge added small />
        <Icon name="claude" />
      </>,
    );
    expect(screen.getByText("plain")).toHaveClass("badge", "b-neutral");
    expect(screen.getByText("ok")).toHaveClass("b-ok", "b-sm", "x");
    expect(screen.getByRole("button", { name: /Go/ })).toHaveClass("btn-primary");
    expect(screen.getByRole("button", { name: "Quiet" })).toHaveClass("btn-quiet", "btn-sm");
    expect(screen.getByRole("button", { name: "Close it" })).toHaveAttribute("title", "Close it");
    expect(screen.getByRole("button", { name: "Other" })).toHaveAttribute("title", "Custom title");
    expect(screen.getByRole("button", { name: "Other" })).not.toHaveClass("btn-sm");
    expect(screen.getByText("Changed by Claude")).toBeInTheDocument();
    expect(screen.getByText("Added by Claude")).toBeInTheDocument();
  });

  it("renders chips: static, pressable, removable, in error", () => {
    const click = vi.fn();
    const remove = vi.fn();
    render(
      <>
        <Chip title="t">static</Chip>
        <Chip on small icon="link" onClick={click}>
          pressed
        </Chip>
        <Chip error onRemove={remove}>
          bad
        </Chip>
        <RequirementChip id="REQ-1" error onRemove={remove} />
        <RequirementChip id="REQ-2" onClick={click} />
      </>,
    );
    expect(screen.getByText("static")).toHaveClass("chip");
    fireEvent.click(screen.getByRole("button", { name: "pressed" }));
    expect(screen.getByRole("button", { name: "pressed" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("bad")).toHaveClass("chip-err");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove requirement REQ-1" }));
    fireEvent.click(screen.getByRole("button", { name: "REQ-2" }));
    expect(click).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it("renders fields with and without a hint", () => {
    render(
      <>
        <Field label="Name" htmlFor="n" hint="Shown in Jira" action={<span>act</span>} className="c">
          <input id="n" />
        </Field>
        <Field label="Bare">
          <input />
        </Field>
      </>,
    );
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByText("Shown in Jira")).toBeInTheDocument();
    expect(screen.getByText("act")).toBeInTheDocument();
  });

  it("renders findings by severity, stale or not", () => {
    const f = (severity: Finding["severity"]): Finding =>
      ({ severity, kind: "missing-source", message: `${severity} message`, sources: [] }) as unknown as Finding;
    render(
      <>
        <FindingCard finding={f("error")} scope="Step 2">
          <span>child</span>
        </FindingCard>
        <FindingCard finding={f("warning")} />
        <FindingCard finding={f("info")} />
        <FindingCard finding={f("error")} stale />
      </>,
    );
    const notes = screen.getAllByRole("note");
    expect(notes[0]).toHaveClass("f-err");
    expect(notes[1]).toHaveClass("f-warn");
    expect(notes[2]).toHaveClass("f-info");
    expect(notes[3]).toHaveClass("f-stale");
    expect(screen.getByText("Error · Missing source")).toBeInTheDocument();
    expect(screen.getByText("Out of date · Error · Missing source")).toBeInTheDocument();
    expect(screen.getByText("Step 2")).toBeInTheDocument();
    expect(screen.getByText(/Run the check again/)).toBeInTheDocument();
  });

  it("falls back for unknown review and sync states", () => {
    render(
      <>
        <ReviewBadge review={"weird" as Review} suffix=" ·" />
        <ReviewBadge review="validated" small />
        <SyncBadge sync={"weird" as SyncState} />
        <SyncBadge sync="remote-changed" small />
      </>,
    );
    expect(screen.getByText(/Draft/)).toBeInTheDocument();
    expect(screen.getByText("Validated")).toBeInTheDocument();
    expect(screen.getByText("Local only")).toBeInTheDocument();
    expect(screen.getByText("Changed in Jira")).toBeInTheDocument();
  });

  it("renders severity words, skeleton sizes and segments", () => {
    const change = vi.fn();
    const { container } = render(
      <>
        <Severity tone="stale" />
        <Severity tone="ok">fine</Severity>
        <Skeleton />
        <Skeleton w="40%" h="1em" r={4} className="k" style={{ opacity: 0.5 }} />
        <Skeleton w={30} h={5} />
        <Segmented
          label="Filter"
          value="a"
          className="s"
          onChange={change}
          options={[
            { value: "a", label: "All", count: 3 },
            { value: "b", label: "Bad", title: "only bad", disabled: true },
            { value: "c", label: "Clean" },
          ]}
        />
      </>,
    );
    expect(screen.getByText("Out of date")).toBeInTheDocument();
    const sk = container.querySelectorAll(".sk");
    expect((sk[1] as HTMLElement).style.width).toBe("40%");
    expect((sk[2] as HTMLElement).style.width).toBe("30px");
    expect(screen.getByRole("button", { name: /All/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Clean" }));
    expect(change).toHaveBeenCalledWith("c");
    expect(screen.getByRole("button", { name: "Bad" })).toBeDisabled();
  });

  it("switches tabs", () => {
    const change = vi.fn();
    render(
      <Tabs
        label="Mode"
        value="a"
        onChange={change}
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B", title: "the b tab" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "B" }));
    expect(change).toHaveBeenCalledWith("b");
    expect(screen.getByRole("tab", { name: "A" })).toHaveAttribute("aria-selected", "true");
  });

  it("renders source chips for passages and figures, inline or not", () => {
    const open = vi.fn();
    render(
      <>
        <SourceChip source={{ docId: "D", anchor: "§1", quote: "le texte" }} onOpen={open} on />
        <SourceChip source={{ docId: "D", anchor: "fig:2", quote: "" }} />
        <SourceChip source={{ docId: "E", anchor: "§3", quote: "q" }} inline onOpen={open} />
        <SourceChip source={{ docId: "F", anchor: "§4", quote: "hidden" }} quote={false} />
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: /D §1/ }));
    expect(open).toHaveBeenCalledWith({ docId: "D", anchor: "§1", quote: "le texte" });
    expect(screen.getByText("« le texte »")).toBeInTheDocument();
    expect(screen.getByText("Figure 2").closest(".chip")).toHaveAttribute("title", "D#fig:2");
    expect(screen.getByRole("button", { name: "E §3" })).toHaveClass("chip-inline");
    expect(screen.queryByText("« hidden »")).toBeNull();
  });
});

describe("Menu", () => {
  const items = (pick: () => void) => [
    { key: "a", label: "Alpha", icon: "folder" as const, hint: "Ctrl A", on: true, onSelect: pick },
    { kind: "sep" as const, key: "s" },
    { key: "b", label: "Beta", disabled: true, title: "nope", onSelect: pick },
  ];

  it("opens, picks an item and closes", () => {
    const pick = vi.fn();
    render(
      <Menu
        label="Things"
        align="right"
        up
        className="m"
        items={items(pick)}
        trigger={({ open, toggle }) => (
          <button type="button" onClick={toggle}>
            {open ? "Close" : "Open"}
          </button>
        )}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("menu", { name: "Things" })).toHaveClass("is-right", "is-up");
    expect(screen.getByRole("menuitem", { name: /Alpha/ })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("menuitem", { name: /Beta/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: /Alpha/ }));
    expect(pick).toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes on Escape and on a click outside, not on a click inside", () => {
    render(
      <div>
        <span>outside</span>
        <Menu
          label="Things"
          items={items(() => {})}
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle}>
              Open
            </button>
          )}
        />
      </div>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Modal", () => {
  it("closes on Escape and on the overlay, and takes focus", () => {
    const close = vi.fn();
    render(
      <Modal
        label="Dialog"
        title="Title"
        subtitle="Sub"
        width={400}
        className="c"
        foot={<span>foot</span>}
        onClose={close}
      >
        <p>body</p>
      </Modal>,
    );
    const dialog = screen.getByRole("dialog", { name: "Dialog" });
    expect(dialog).toHaveFocus();
    expect(dialog.style.width).toBe("400px");
    fireEvent.keyDown(window, { key: "x" });
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByText("body"));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(dialog.parentElement as HTMLElement);
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("renders without a head or foot and keeps focus already inside", () => {
    render(
      <Modal label="Bare" onClose={() => {}}>
        <input aria-label="inner" autoFocus />
      </Modal>,
    );
    expect(screen.getByLabelText("inner")).toHaveFocus();
    expect(document.querySelector(".dialog-head")).toBeNull();
    expect(document.querySelector(".dialog-foot")).toBeNull();
    cleanup();
    render(
      <Modal label="Only sub" subtitle="s" onClose={() => {}}>
        <p>x</p>
      </Modal>,
    );
    expect(document.querySelector(".dialog-title")).toBeNull();
  });
});

describe("Toasts", () => {
  it("shows each kind, runs an action and dismisses", () => {
    const run = vi.fn();
    const expire = vi.fn();
    const { container } = render(<Toasts />);
    expect(container.firstChild).toBeNull();
    act(() => {
      toast({ kind: "error", title: "Broken", detail: "why" });
      toast({ kind: "ok", title: "Done", action: { label: "Open", run }, onExpire: expire });
      toast({ kind: "info", title: "Note" });
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Brokenwhy");
    expect(screen.getAllByRole("status")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(run).toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
    expect(screen.queryByText("Done")).toBeNull();
    const dismiss = screen.getAllByRole("button", { name: "Dismiss" });
    for (const b of dismiss) fireEvent.click(b);
    expect(container.firstChild).toBeNull();
  });

  it("leaves no toast behind", () => {
    render(<Left />);
    act(() => {
      const id = toast({ kind: "error", title: "x" });
      closeToast(id, true);
    });
    expect(left).toBe(0);
  });
});
