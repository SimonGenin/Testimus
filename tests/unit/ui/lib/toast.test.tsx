// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, setProject } from "../../../../src/ui/api.ts";
import { Toaster } from "../../../../src/ui/components/ui/Toast.tsx";
import { closeToast, errorToast, type Toast, toast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { fakeNet } from "../../helpers/ui-data.tsx";
import { noDesktop } from "../../helpers/ui-desktop.tsx";

beforeEach(() => fakeNet());

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
  localStorage.clear();
  sessionStorage.clear();
});

describe("toasts", () => {
  const clear = (list: Toast[]) => {
    for (const t of list) closeToast(t.id, true);
  };

  it("expires info toasts after six seconds and keeps errors until dismissed", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToasts());
    const expired = vi.fn();
    const closed = vi.fn();
    act(() => {
      toast({ kind: "info", title: "Saved", onExpire: expired });
      toast({ kind: "error", title: "Broken", onExpire: closed });
    });
    expect(result.current.map((t) => t.title)).toEqual(["Saved", "Broken"]);
    act(() => vi.advanceTimersByTime(6000));
    expect(expired).toHaveBeenCalledTimes(1);
    expect(result.current.map((t) => t.title)).toEqual(["Broken"]);
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current).toHaveLength(1);
    act(() => closeToast(result.current[0].id));
    expect(closed).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([]);
  });

  it("keeps the last three, expiring the ones it drops", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToasts());
    const dropped = vi.fn();
    act(() => {
      toast({ kind: "ok", title: "1", onExpire: dropped });
      toast({ kind: "ok", title: "2" });
      toast({ kind: "ok", title: "3" });
      toast({ kind: "ok", title: "4", left: 2 });
    });
    expect(dropped).toHaveBeenCalledTimes(1);
    expect(result.current.map((t) => t.title)).toEqual(["2", "3", "4"]);
    const undone = vi.fn();
    act(() => {
      const id = toast({ kind: "error", title: "kept", onExpire: undone });
      closeToast(id, true);
    });
    expect(undone).not.toHaveBeenCalled();
    act(() => clear(result.current));
  });

  it("puts the fix of an ApiError in the detail", () => {
    const { result } = renderHook(() => useToasts());
    act(() => {
      errorToast(new ApiError("Jira 401", "check the token"));
      errorToast(new ApiError("plain"), "Push failed");
      errorToast("oops");
    });
    expect(result.current.map((t) => [t.title, t.detail])).toEqual([
      ["Something went wrong", "Jira 401 — check the token"],
      ["Push failed", "plain"],
      ["Something went wrong", "oops"],
    ]);
    act(() => clear(result.current));
  });
});

let left = -1;
function Left() {
  left = useToasts().length;
  return null;
}

describe("the screens' toasts on the kit's stack", () => {
  afterEach(cleanup);

  it("shows each kind, runs an action without committing it, and dismisses", () => {
    const run = vi.fn();
    const expire = vi.fn();
    render(<Toaster />);
    const stack = screen.getByRole("region", { name: "Notifications" });
    expect(stack).toBeEmptyDOMElement();
    act(() => {
      toast({ kind: "error", title: "Broken", detail: "why" });
      toast({ kind: "ok", title: "Done", action: { label: "Open", run }, onExpire: expire });
      toast({ kind: "info", title: "Note" });
    });
    expect(screen.getByRole("alert", { name: "Broken" })).toHaveTextContent("Brokenwhy");
    expect(within(stack).getAllByRole("status")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(run).toHaveBeenCalled();
    expect(expire).not.toHaveBeenCalled();
    expect(screen.queryByText("Done")).toBeNull();
    for (const b of screen.getAllByRole("button", { name: "Dismiss" })) fireEvent.click(b);
    expect(stack).toBeEmptyDOMElement();
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
