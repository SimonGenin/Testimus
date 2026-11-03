// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, Toast, Toaster, type ToastProps, toast } from "../../../../src/ui/components/ui/Toast.tsx";

let ids: number[] = [];
const show = (o: ToastProps) => {
  let id = 0;
  act(() => {
    id = toast(o);
  });
  ids.push(id);
  return id;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    for (const id of ids) dismissToast(id);
  });
  ids = [];
  cleanup();
  vi.useRealTimers();
});

const cls = (el: Element) => el.getAttribute("class") ?? "";
const region = () => screen.getByRole("region", { name: "Notifications" });

describe("Toast", () => {
  it("tells a passing result with a second line, in a status, and leaves after 6 s without being acted on", () => {
    const onExpire = vi.fn();
    render(<Toaster />);
    show({ tone: "success", title: "LFRPS12-1398 pulled", text: "5 steps · 2 images", onExpire });
    const t = within(region()).getByRole("status", { name: "LFRPS12-1398 pulled" });
    expect(t).toHaveTextContent("5 steps · 2 images");
    act(() => vi.advanceTimersByTime(5000));
    expect(screen.getByRole("status", { name: "LFRPS12-1398 pulled" })).toBeInTheDocument();
    expect(onExpire).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByRole("status", { name: "LFRPS12-1398 pulled" })).toBeNull();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("a danger toast is an alert and stays until dismissed; dismissing runs its onExpire", () => {
    const onExpire = vi.fn();
    render(<Toaster />);
    show({ tone: "danger", title: "Pull failed — LFRPS12-1398", text: "Jira refused the request (403).", onExpire });
    act(() => vi.advanceTimersByTime(60_000));
    const t = screen.getByRole("alert", { name: "Pull failed — LFRPS12-1398" });
    fireEvent.click(within(t).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("its action counts down in its label (« Undo · 5 s »); taking it closes the toast without onExpire", () => {
    const onAction = vi.fn();
    const onExpire = vi.fn();
    render(<Toaster />);
    show({ title: "Step 3 deleted", action: { label: "Undo", onAction }, seconds: 5, onExpire });
    const t = screen.getByRole("status", { name: "Step 3 deleted" });
    expect(within(t).getByRole("button", { name: "Undo · 5 s" })).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1000));
    fireEvent.click(within(t).getByRole("button", { name: "Undo · 4 s" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onExpire).not.toHaveBeenCalled();
    expect(screen.queryByRole("status", { name: "Step 3 deleted" })).toBeNull();
  });

  it("a lasting toast's action has no countdown", () => {
    render(<Toaster />);
    show({ tone: "danger", title: "Push failed", action: { label: "Retry", onAction: () => {} } });
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("keeps three at most, the newest at the bottom; the one pushed out expires", () => {
    const first = vi.fn();
    render(<Toaster />);
    show({ title: "One", onExpire: first });
    show({ title: "Two" });
    show({ title: "Three" });
    show({ title: "Four", tone: "claude", text: "6 tests written" });
    const shown = within(region()).getAllByRole("status");
    expect(shown.map((t) => t.getAttribute("aria-label"))).toEqual(["Two", "Three", "Four"]);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("dismissToast removes one by its id, and toast() returns distinct ids", () => {
    render(<Toaster />);
    const a = show({ title: "Reloaded from disk", tone: "warning" });
    const b = show({ title: "Other" });
    expect(a).not.toBe(b);
    act(() => dismissToast(a));
    expect(screen.queryByRole("status", { name: "Reloaded from disk" })).toBeNull();
    expect(screen.getByRole("status", { name: "Other" })).toBeInTheDocument();
    act(() => dismissToast(9999));
  });

  it("each tone has its own icon colour; danger has its own edge", () => {
    const tones = ["neutral", "success", "warning", "danger", "claude"] as const;
    const icons = new Set<string>();
    const cards = new Set<string>();
    for (const tone of tones) {
      render(<Toast tone={tone} title={`T ${tone}`} />);
      const el = screen.getByRole(tone === "danger" ? "alert" : "status", { name: `T ${tone}` });
      icons.add(cls(el.firstElementChild as Element));
      cards.add(cls(el));
    }
    expect(icons.size).toBe(tones.length);
    expect(cards.size).toBe(2);
    const onDismiss = vi.fn();
    const onAction = vi.fn();
    render(<Toast title="Plain" action={{ label: "Open", onAction }} left={3} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Open · 3 s" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    fireEvent.click(within(screen.getByRole("status", { name: "Plain" })).getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
