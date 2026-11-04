// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../../../../src/ui/components/ui/Button.tsx";
import { Card } from "../../../../src/ui/components/ui/Card.tsx";
import { Disclosure } from "../../../../src/ui/components/ui/Disclosure.tsx";
import { EmptyState } from "../../../../src/ui/components/ui/EmptyState.tsx";
import { Progress } from "../../../../src/ui/components/ui/Progress.tsx";
import { ResizeHandle, type ResizeHandleProps } from "../../../../src/ui/components/ui/ResizeHandle.tsx";
import { Skeleton } from "../../../../src/ui/components/ui/Skeleton.tsx";
import { Timeline } from "../../../../src/ui/components/ui/Timeline.tsx";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const cls = (el: Element) => el.getAttribute("class") ?? "";

describe("Skeleton", () => {
  it("draws each kind hidden from assistive technology, at the width asked", () => {
    const { container } = render(
      <>
        <Skeleton />
        <Skeleton kind="title" width="40%" />
        <Skeleton kind="block" />
        <Skeleton kind="circle" />
      </>,
    );
    const bars = [...container.children];
    expect(bars.every((b) => b.getAttribute("aria-hidden") === "true")).toBe(true);
    expect(new Set(bars.map(cls)).size).toBe(4);
    expect((bars[1] as HTMLElement).style.width).toBe("40%");
  });

  it("draws several lines, the last shorter, and a list row", () => {
    const { container } = render(
      <>
        <Skeleton lines={3} width="90%" />
        <Skeleton kind="row" />
      </>,
    );
    const [lines, row] = [...container.children];
    expect(lines.children).toHaveLength(3);
    expect((lines.children[0] as HTMLElement).style.width).toBe("90%");
    expect(cls(lines.children[2])).not.toBe(cls(lines.children[0]));
    expect(row.querySelectorAll("span")).toHaveLength(4);
  });

  it("after 10 s without data says so and offers Retry", () => {
    vi.useFakeTimers();
    const onRetry = vi.fn();
    render(<Skeleton onRetry={onRetry} />);
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(9_999));
    expect(screen.queryByRole("status")).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("Still loading");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
  });
});

function Pane(p: Partial<ResizeHandleProps>) {
  const [w, setW] = useState(300);
  return (
    <ResizeHandle label="Test list width" value={w} min={240} max={480} defaultValue={300} onChange={setW} {...p} />
  );
}

describe("ResizeHandle", () => {
  it("is a focusable separator that says its size", () => {
    render(<Pane />);
    const s = screen.getByRole("separator", { name: "Test list width" });
    expect(s).toHaveAttribute("tabindex", "0");
    expect(s).toHaveAttribute("aria-orientation", "vertical");
    expect(s).toHaveAttribute("aria-valuenow", "300");
    expect(s).toHaveAttribute("aria-valuemin", "240");
    expect(s).toHaveAttribute("aria-valuemax", "480");
  });

  it("moves 16 px per arrow within its bounds; Home resets, End is the largest; each key is committed", () => {
    const onCommit = vi.fn();
    render(<Pane onCommit={onCommit} />);
    const s = screen.getByRole("separator");
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(s).toHaveAttribute("aria-valuenow", "316");
    fireEvent.keyDown(s, { key: "ArrowLeft" });
    fireEvent.keyDown(s, { key: "ArrowLeft" });
    expect(s).toHaveAttribute("aria-valuenow", "284");
    fireEvent.keyDown(s, { key: "End" });
    expect(s).toHaveAttribute("aria-valuenow", "480");
    fireEvent.keyDown(s, { key: "ArrowRight" });
    expect(s).toHaveAttribute("aria-valuenow", "480");
    fireEvent.keyDown(s, { key: "Home" });
    expect(s).toHaveAttribute("aria-valuenow", "300");
    fireEvent.keyDown(s, { key: "Tab" });
    expect(onCommit.mock.calls.map((c) => c[0])).toEqual([316, 300, 284, 480, 480, 300]);
  });

  it("on the left edge of its pane, dragging or pressing left widens it", () => {
    render(<Pane side="left" />);
    const s = screen.getByRole("separator");
    fireEvent.keyDown(s, { key: "ArrowLeft" });
    expect(s).toHaveAttribute("aria-valuenow", "316");
    fireEvent.pointerDown(s, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 80 });
    fireEvent.pointerUp(s);
    expect(s).toHaveAttribute("aria-valuenow", "336");
    fireEvent.doubleClick(s);
    expect(s).toHaveAttribute("aria-valuenow", "300");
  });

  it("follows a drag, clamps it, commits once when it ends, and a double-click resets", () => {
    const onCommit = vi.fn();
    render(<Pane onCommit={onCommit} />);
    const s = screen.getByRole("separator");
    fireEvent.pointerDown(s, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(s, { clientX: 140 });
    expect(s).toHaveAttribute("aria-valuenow", "340");
    fireEvent.pointerMove(s, { clientX: 900 });
    expect(s).toHaveAttribute("aria-valuenow", "480");
    fireEvent.pointerUp(s);
    fireEvent.lostPointerCapture(s);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(480);
    fireEvent.pointerMove(s, { clientX: 100 });
    expect(s).toHaveAttribute("aria-valuenow", "480");
    fireEvent.doubleClick(s);
    expect(s).toHaveAttribute("aria-valuenow", "300");
    expect(onCommit).toHaveBeenLastCalledWith(300);
  });

  it("horizontal, resizes a height with the vertical arrows and drags", () => {
    render(<Pane orientation="horizontal" />);
    const s = screen.getByRole("separator");
    expect(s).toHaveAttribute("aria-orientation", "horizontal");
    fireEvent.keyDown(s, { key: "ArrowDown" });
    expect(s).toHaveAttribute("aria-valuenow", "316");
    fireEvent.keyDown(s, { key: "ArrowUp" });
    expect(s).toHaveAttribute("aria-valuenow", "300");
    fireEvent.pointerDown(s, { clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(s, { clientY: 30 });
    fireEvent.pointerCancel(s);
    expect(s).toHaveAttribute("aria-valuenow", "320");
  });

  it("lights its line on hover, focus and drag, and in the catalogue states", () => {
    const line = (p: Partial<ResizeHandleProps>, label: string) => {
      render(<Pane label={label} {...p} />);
      return screen.getByRole("separator", { name: label });
    };
    const rest = line({}, "rest");
    const hover = line({ debugState: "hover" }, "hover");
    const focus = line({ debugState: "focus" }, "focus");
    const drag = line({ debugState: "drag" }, "drag");
    const look = (s: HTMLElement) => cls(s.firstElementChild as Element);
    expect(look(hover)).not.toBe(look(rest));
    expect(look(focus)).not.toBe(look(rest));
    expect(look(focus)).not.toBe(look(hover));
    expect(look(drag)).toBe(look(hover));
    fireEvent.pointerEnter(rest);
    expect(look(rest)).toBe(look(hover));
    fireEvent.pointerLeave(rest);
    fireEvent.focus(rest);
    expect(look(rest)).toBe(look(focus));
    fireEvent.blur(rest);
    expect(look(rest)).not.toBe(look(focus));
  });

  it("quiet, draws no line at rest but the same lit line on hover, focus and drag", () => {
    const line = (p: Partial<ResizeHandleProps>, label: string) => {
      render(<Pane label={label} {...p} />);
      return screen.getByRole("separator", { name: label });
    };
    const look = (s: HTMLElement) =>
      cls(s.firstElementChild as Element)
        .split(" ")
        .filter((c) => !c.includes("__"))
        .sort()
        .join(" ");
    const rest = line({}, "rest");
    const quiet = line({ quiet: true }, "quiet");
    const hover = line({ debugState: "hover" }, "hover");
    const focus = line({ debugState: "focus" }, "focus");
    const still = look(quiet);
    expect(still).not.toBe(look(rest));
    expect(look(line({ quiet: true, debugState: "hover" }, "quiet hover"))).toBe(look(hover));
    expect(look(line({ quiet: true, debugState: "focus" }, "quiet focus"))).toBe(look(focus));
    expect(look(line({ quiet: true, debugState: "drag" }, "quiet drag"))).toBe(look(hover));
    fireEvent.pointerEnter(quiet);
    expect(look(quiet)).toBe(look(hover));
    fireEvent.pointerLeave(quiet);
    expect(look(quiet)).toBe(still);
    fireEvent.focus(quiet);
    expect(look(quiet)).toBe(look(focus));
    fireEvent.blur(quiet);
    expect(look(quiet)).toBe(still);
    expect(quiet).toHaveAttribute("tabindex", "0");
  });
});

describe("EmptyState", () => {
  it("shows its mark, what is missing, how to fill it and its actions", () => {
    render(
      <EmptyState
        icon="documents"
        title="No document yet"
        text="Add the specifications your tests come from."
        actions={<Button variant="primary" label="Add documents" />}
      />,
    );
    expect(screen.getByText("No document yet")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText(/specifications/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add documents" })).toBeInTheDocument();
  });

  it("is tighter when compact", () => {
    const { container } = render(
      <>
        <EmptyState icon="tests" title="a" />
        <EmptyState icon="tests" title="b" compact />
      </>,
    );
    const [a, b] = [...container.children];
    expect(cls(a)).not.toBe(cls(b));
  });
});

describe("Progress", () => {
  it("is a progress bar with its value, clamped, and its detail", () => {
    render(
      <>
        <Progress label="Index" value={40} detail="12 / 40 sections" />
        <Progress label="Over" value={140} />
        <Progress label="Under" value={-5} />
      </>,
    );
    const bar = screen.getByRole("progressbar", { name: "Index" });
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuetext", "12 / 40 sections");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("40%");
    expect(screen.getByText("12 / 40 sections")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Over" })).toHaveAttribute("aria-valuenow", "100");
    expect(screen.getByRole("progressbar", { name: "Under" })).toHaveAttribute("aria-valuenow", "0");
  });

  it("without a value is indeterminate, and each tone fills differently", () => {
    render(
      <>
        <Progress label="Pull" value={null} />
        <Progress label="accent" value={50} />
        <Progress label="claude" value={50} tone="claude" />
        <Progress label="success" value={100} tone="success" />
      </>,
    );
    const pull = screen.getByRole("progressbar", { name: "Pull" });
    expect(pull).not.toHaveAttribute("aria-valuenow");
    expect(pull).not.toHaveAttribute("aria-valuemax");
    const fill = (n: string) => cls(screen.getByRole("progressbar", { name: n }).firstElementChild as Element);
    expect(new Set(["Pull", "accent", "claude", "success"].map(fill)).size).toBe(4);
  });
});

function Packs() {
  const [v, setV] = useState("light");
  return (
    <div role="radiogroup" aria-label="Search packs">
      {["light", "balanced", "heavy"].map((p) => (
        <Card
          key={p}
          title={p}
          radio={{ name: "pack", value: p, checked: v === p, onSelect: setV, disabled: p === "heavy" }}
          debugState={p === "balanced" ? "hover" : undefined}
        >
          <span>{`${p} models`}</span>
        </Card>
      ))}
    </div>
  );
}

describe("Card", () => {
  it("with a title is a section named by it, with actions, body and foot", () => {
    render(
      <Card title="Claude dock" actions={<Button size="sm" label="Reset" />} footer="Applies to new runs.">
        Default model
      </Card>,
    );
    const card = screen.getByRole("region", { name: "Claude dock" });
    expect(within(card).getByRole("button", { name: "Reset" })).toBeInTheDocument();
    expect(card).toHaveTextContent("Default model");
    expect(card).toHaveTextContent("Applies to new runs.");
  });

  it("without a title is a plain frame; selected, flush and alone look different", () => {
    const { container } = render(
      <>
        <Card>alone</Card>
        <Card selected>selected</Card>
        <Card padded={false} actions={<span>x</span>}>
          flush
        </Card>
      </>,
    );
    expect(screen.queryByRole("region")).toBeNull();
    const [a, s] = [...container.children];
    expect(cls(a)).not.toBe(cls(s));
    const bodies = ["alone", "flush"].map((t) => cls(screen.getByText(t)));
    expect(bodies[0]).not.toBe(bodies[1]);
  });

  it("as a radio, the whole card picks it and the radio is named by its title", () => {
    render(<Packs />);
    const light = screen.getByRole("radio", { name: "light" });
    const balanced = screen.getByRole("radio", { name: "balanced" });
    expect(light).toBeChecked();
    fireEvent.click(screen.getByText("balanced models"));
    expect(balanced).toBeChecked();
    expect(light).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "heavy" })).toBeDisabled();
    const card = (n: string) => cls(screen.getByText(`${n} models`).closest("label") as Element);
    expect(new Set(["light", "balanced", "heavy"].map(card)).size).toBe(3);
  });

  it("a radio card's focus state is drawn for the catalogue", () => {
    render(
      <>
        <Card radio={{ name: "d", value: "c", checked: false, onSelect: () => {} }}>c</Card>
        <Card radio={{ name: "d", value: "d", checked: false, onSelect: () => {} }} debugState="focus">
          d
        </Card>
      </>,
    );
    const [c, d] = screen.getAllByRole("radio").map((r) => cls(r.closest("label") as Element));
    expect(c).not.toBe(d);
  });
});

describe("Disclosure", () => {
  it("folds its content behind a summary button that says whether it is open", () => {
    const onOpenChange = vi.fn();
    render(
      <Disclosure summary="Technical details" meta="3 lines" onOpenChange={onOpenChange}>
        exit 1
      </Disclosure>,
    );
    const b = screen.getByRole("button", { name: "Technical details" });
    expect(b).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("exit 1")).toBeNull();
    expect(screen.getByText("3 lines")).toBeInTheDocument();
    fireEvent.click(b);
    expect(b).toHaveAttribute("aria-expanded", "true");
    const region = screen.getByRole("region", { name: "Technical details" });
    expect(b).toHaveAttribute("aria-controls", region.id);
    expect(region).toHaveTextContent("exit 1");
    expect(onOpenChange).toHaveBeenCalledWith(true);
    fireEvent.click(b);
    expect(screen.queryByText("exit 1")).toBeNull();
  });

  it("can start open, be controlled, be quiet, and show the catalogue states", () => {
    const onOpenChange = vi.fn();
    render(
      <>
        <Disclosure summary="open" defaultOpen>
          shown
        </Disclosure>
        <Disclosure summary="controlled" open={false} onOpenChange={onOpenChange}>
          never
        </Disclosure>
        <Disclosure summary="quiet" quiet>
          q
        </Disclosure>
        <Disclosure summary="hover" debugState="hover">
          h
        </Disclosure>
        <Disclosure summary="focus" debugState="focus">
          f
        </Disclosure>
      </>,
    );
    expect(screen.getByText("shown")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "controlled" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(screen.queryByText("never")).toBeNull();
    const looks = new Set(
      ["controlled", "quiet", "hover", "focus"].map((n) => cls(screen.getByRole("button", { name: n }))),
    );
    expect(looks.size).toBe(4);
  });
});

describe("Timeline", () => {
  it("is an ordered list of steps, each state an icon whose word is read out, the running one current", () => {
    render(
      <Timeline
        label="Steps of the job"
        items={[
          { key: "read", state: "done", title: "Read the documents", time: "0:12" },
          { key: "plan", state: "running", title: "Plan the tests", note: "2 processes" },
          { key: "write", state: "waiting", title: "Write the tests" },
          { key: "push", state: "skipped", title: "Push" },
          {
            key: "check",
            state: "failed",
            title: "Check",
            children: (
              <Timeline compact label="Processes" items={[{ key: "p", state: "failed", title: "claude -p" }]} />
            ),
          },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Steps of the job" });
    const steps = within(list).getAllByRole("listitem");
    expect(steps).toHaveLength(6);
    expect(within(steps[0]).getByRole("img", { name: "Done" })).toBeInTheDocument();
    expect(steps[0]).toHaveTextContent("0:12");
    expect(within(steps[1]).getByRole("status", { name: "Running" })).toBeInTheDocument();
    expect(steps[1]).toHaveAttribute("aria-current", "step");
    expect(steps[1]).toHaveTextContent("2 processes");
    expect(within(steps[2]).getByRole("img", { name: "Waiting" })).toBeInTheDocument();
    expect(within(steps[3]).getByRole("img", { name: "Skipped" })).toBeInTheDocument();
    expect(within(steps[4]).getAllByRole("img", { name: "Failed" })).toHaveLength(2);
    expect(within(steps[4]).getByRole("list", { name: "Processes" })).toBeInTheDocument();
  });

  it("draws a Claude run's running step in Claude's colour", () => {
    render(
      <>
        <Timeline label="job" items={[{ key: "a", state: "running", title: "job step" }]} />
        <Timeline label="claude" tone="claude" items={[{ key: "a", state: "running", title: "claude phase" }]} />
      </>,
    );
    expect(cls(screen.getByText("job step"))).not.toBe(cls(screen.getByText("claude phase")));
  });
});
