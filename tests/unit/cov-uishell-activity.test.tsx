// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Activity, elapsed } from "../../src/ui/components/shell/Activity.tsx";
import { DragEdge } from "../../src/ui/components/ui/DragEdge.tsx";
import { Toasts } from "../../src/ui/components/ui/index.ts";
import { closeToast, useToasts } from "../../src/ui/lib/toast.ts";
import { callsOf, deferred, Fail, FakeES, fakeEvents, fakeNet, job, net, status } from "./cov-uishell-helpers.tsx";

let ids: number[] = [];
function Probe() {
  ids = useToasts().map((t) => t.id);
  return <Toasts />;
}

beforeEach(() => {
  fakeNet();
  fakeEvents();
});

afterEach(() => {
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Activity", () => {
  it("formats the time a job has run", () => {
    const t0 = "2026-11-02T10:00:00.000Z";
    expect(elapsed(t0, Date.parse(t0) + 42_000)).toBe("42 s");
    expect(elapsed(t0, Date.parse(t0) + 125_000)).toBe("2:05");
    expect(elapsed(t0, Date.parse(t0) - 5000)).toBe("0 s");
  });

  it("shows nothing while no job runs", async () => {
    net.routes["jobs.list"] = () => ({ not: "a list" });
    const { container } = render(<Activity />);
    await waitFor(() => expect(callsOf("jobs.list")).toHaveLength(1));
    expect(container.querySelector("button")).toBeNull();
  });

  it("counts the running jobs, follows their events and lists them on click", async () => {
    net.routes["jobs.list"] = () => [
      job({ id: "a", kind: "pull", subject: "LFRPS12", message: "Reading" }),
      job({ id: "b", kind: "odd", subject: "", startedAt: "2026-11-02T09:00:00.000Z" }),
      job({ id: "z", status: "done" }),
    ];
    net.routes["jobs.cancel"] = (i) => {
      if (i.id === "b") throw new Fail("gone");
      return null;
    };
    render(
      <>
        <Activity />
        <Probe />
      </>,
    );
    const btn = await screen.findByRole("button", { name: "2 jobs running" });
    act(() => {
      FakeES.emit(status(job({ id: "c", kind: "generate", subject: "Gen", message: "Starting" })));
      FakeES.emit({ jobId: "a", at: "", type: "progress", message: "Writing 2", done: 2, total: 8 });
      FakeES.emit({ jobId: "nope", at: "", type: "progress", message: "ignored" });
      FakeES.emit({ jobId: "a", at: "", type: "log", level: "info", message: "ignored" });
      FakeES.emit(status(job({ id: "c", kind: "generate", subject: "Gen" })));
    });
    expect(screen.getByRole("button", { name: "3 jobs running" })).toBe(btn);
    fireEvent.click(btn);
    const pop = screen.getByRole("dialog", { name: "Running jobs" });
    expect(pop.querySelector(".busy-head")).toHaveTextContent("Running3");
    const rows = pop.querySelectorAll(".busy");
    expect([...rows].map((r) => r.querySelector(".busy-label")?.textContent)).toEqual(["odd", "LFRPS12", "Gen"]);
    expect([...rows].map((r) => r.className)).toEqual(["busy busy-plain", "busy busy-plain", "busy busy-claude"]);
    expect(rows[1]).toHaveTextContent("Writing 2");
    expect(rows[1].querySelector(".busy-steps")).toHaveTextContent("2/8");
    expect(rows[1].querySelector<HTMLElement>(".busy-fill")?.style.width).toBe("25%");
    expect(rows[2]).toHaveTextContent("Starting");
    expect(rows[2].querySelector(".busy-bar")).toHaveClass("is-open");
    expect(rows[0].querySelector(".busy-detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel LFRPS12" }));
    await waitFor(() => expect(callsOf("jobs.cancel")[0].input).toEqual({ id: "a" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel odd" }));
    expect(await screen.findByText("Could not cancel")).toBeInTheDocument();
    fireEvent.click(btn);
    expect(screen.queryByRole("dialog", { name: "Running jobs" })).toBeNull();
    expect(callsOf("jobs.list")).toHaveLength(2);
  });

  it("closes on Escape, on a click outside and when the last job ends", async () => {
    net.routes["jobs.list"] = () => [job({ id: "a" })];
    render(
      <div>
        <span>outside</span>
        <Activity />
      </div>,
    );
    const btn = await screen.findByRole("button", { name: "1 job running" });
    fireEvent.click(btn);
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(btn);
    fireEvent.mouseDown(screen.getByText("outside"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(btn);
    expect(screen.getByRole("dialog")).toHaveStyle({ top: "8px", left: "8px" });
    fireEvent(window, new Event("resize"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(btn);
    act(() => FakeES.emit(status(job({ id: "a", status: "done" }))));
    expect(screen.queryByRole("button", { name: /running/ })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps a job ended by an event out of a list read that lands later, and ticks while open", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const gate = deferred();
    net.routes["jobs.list"] = async () => {
      await gate.promise;
      return [job({ id: "a", startedAt: new Date(Date.now() - 3000).toISOString() }), job({ id: "b" })];
    };
    render(<Activity />);
    act(() => FakeES.emit(status(job({ id: "b", status: "done" }))));
    await act(async () => gate.resolve(null));
    const btn = await screen.findByRole("button", { name: "1 job running" });
    fireEvent.click(btn);
    const time = () => screen.getByRole("dialog").querySelector(".busy-time")?.textContent;
    const first = time();
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(time()).not.toBe(first);
  });

  it("tones each row by its kind and starts a bar from the job's own progress", async () => {
    net.routes["jobs.list"] = () => [
      job({ id: "a", kind: "docs.convert", subject: "RS", progress: { done: 1, total: 4 } }),
      job({ id: "b", kind: "models-pull", subject: "bge" }),
    ];
    render(<Activity />);
    fireEvent.click(await screen.findByRole("button", { name: "2 jobs running" }));
    const rows = screen.getByRole("dialog").querySelectorAll(".busy");
    expect([...rows].map((r) => r.className)).toEqual(["busy busy-doc", "busy busy-plain"]);
    expect(rows[0].querySelector(".busy-steps")).toHaveTextContent("1/4");
    expect(rows[1].querySelector(".busy-steps")).toBeNull();
  });

  it("survives a failed list read", async () => {
    net.routes["jobs.list"] = () => {
      throw new Fail("down");
    };
    render(<Activity />);
    await waitFor(() => expect(callsOf("jobs.list")).toHaveLength(1));
    act(() => FakeES.emit(status(job({ id: "a" }))));
    expect(screen.getByRole("button", { name: "1 job running" })).toBeInTheDocument();
  });
});

describe("DragEdge", () => {
  const pointer = (type: string, el: Element, clientX: number) =>
    fireEvent(el, Object.assign(new MouseEvent(type, { bubbles: true, clientX }), { pointerId: 1 }));

  it("drags a width from the start width, commits once and resets on double-click", () => {
    const panel = document.createElement("div");
    panel.getBoundingClientRect = () => ({ width: 300 }) as DOMRect;
    const onWidth = vi.fn();
    const onCommit = vi.fn();
    const onReset = vi.fn();
    const width = vi.fn((dx: number, w: number) => w + dx + 0.4);
    render(
      <DragEdge
        className="edge"
        label="Resize the list"
        target={() => panel}
        width={width}
        onWidth={onWidth}
        onCommit={onCommit}
        onReset={onReset}
      />,
    );
    const edge = screen.getByRole("separator", { name: "Resize the list" });
    expect(edge).toHaveAttribute("title", "Resize the list — double-click to reset");
    pointer("pointermove", edge, 50);
    expect(onWidth).not.toHaveBeenCalled();
    const capture = vi.fn();
    (edge as HTMLElement & { setPointerCapture: (id: number) => void }).setPointerCapture = capture;
    pointer("pointerdown", edge, 100);
    expect(capture).toHaveBeenCalled();
    expect(edge).toHaveClass("is-dragging", "edge");
    pointer("pointermove", edge, 140);
    expect(width).toHaveBeenCalledWith(40, 300, panel);
    expect(onWidth).toHaveBeenCalledWith(340);
    pointer("pointerup", edge, 140);
    pointer("lostpointercapture", edge, 140);
    pointer("pointercancel", edge, 140);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(edge).not.toHaveClass("is-dragging");
    delete (edge as Partial<HTMLElement & { setPointerCapture: unknown }>).setPointerCapture;
    pointer("pointerdown", edge, 10);
    pointer("pointercancel", edge, 10);
    expect(onCommit).toHaveBeenCalledTimes(2);
    fireEvent.doubleClick(edge);
    expect(onReset).toHaveBeenCalled();
  });
});
