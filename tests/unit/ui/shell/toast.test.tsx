// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "../../../../src/ui/components/ui/Toast.tsx";
import { ApiError } from "../../../../src/ui/lib/data/client.ts";
import { closeToast, errorToast, toast, useToasts } from "../../../../src/ui/lib/toast.ts";
import { clearAllToasts, withToasts } from "./helpers.tsx";

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.useRealTimers();
});

describe("toasts from the screens' words, on the kit's stack", () => {
  it("counts a timed toast down inside its action button, whose name stays the action", async () => {
    withToasts(<Toaster />);
    act(() => {
      toast({ kind: "info", title: "Step deleted", action: { label: "Undo", run: () => {} } });
    });
    const undo = screen.getByRole("button", { name: "Undo" });
    expect(undo).toHaveTextContent(/^Undo ?· 6 s$/);
    await waitFor(() => expect(undo).toHaveTextContent(/^Undo ?· 5 s$/), { timeout: 2500 });
    act(() => {
      toast({ kind: "error", title: "Broken", action: { label: "Retry", run: () => {} } });
    });
    expect(screen.getByRole("button", { name: "Retry" })).toHaveTextContent(/^Retry$/);
  });

  it("an error stays and says the core's fix; an action taken does not commit the toast", () => {
    render(<Toaster />);
    const expired = vi.fn();
    let id = 0;
    act(() => {
      errorToast(new ApiError("Jira 401", "check the token"), "Push failed");
      id = toast({ kind: "ok", title: "Deleted", action: { label: "Undo", run: () => {} }, onExpire: expired });
    });
    expect(screen.getByRole("alert", { name: "Push failed" })).toHaveTextContent("Jira 401 — check the token");
    act(() => closeToast(id, true));
    expect(expired).not.toHaveBeenCalled();
    expect(screen.queryByRole("status", { name: "Deleted" })).toBeNull();
  });

  it("speaks the kit's tones (a warning too); the old words still map onto them", () => {
    let tones: string[] = [];
    function Tones() {
      tones = useToasts().map((t) => t.tone);
      return null;
    }
    render(
      <>
        <Toaster />
        <Tones />
      </>,
    );
    act(() => {
      toast({ tone: "warning", title: "Two figures were skipped" });
      toast({ kind: "ok", title: "Saved" });
    });
    expect(screen.getByRole("status", { name: "Two figures were skipped" })).toBeInTheDocument();
    expect(tones.slice(-2)).toEqual(["warning", "success"]);
  });
});
