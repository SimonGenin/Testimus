// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AutosaveOptions,
  clearDrafts,
  flushAutosaves,
  pendingAutosaves,
  useAutosave,
  useDraft,
} from "../../../../src/ui/lib/data/autosave.ts";
import { ApiError } from "../../../../src/ui/lib/data/client.ts";
import { createQueryClient, execute, type Key } from "../../../../src/ui/lib/data/query.ts";

let n = 0;
const freshKey = (): Key => ["/p", "tests.show", { id: `T${++n}` }];

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  cleanup();
  clearDrafts();
  vi.useRealTimers();
});

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const client = createQueryClient();

function setup(o: Partial<AutosaveOptions<string>> & { save: AutosaveOptions<string>["save"] }) {
  const k = o.key ?? freshKey();
  const props = { key: k, value: "disk", base: "1", ...o };
  const h = renderHook((p: AutosaveOptions<string>) => useAutosave<string>(p), { wrapper, initialProps: props });
  return { ...h, k, props };
}

describe("autosave", () => {
  it("sends the last value 400 ms after the last edit, then shows it saved", async () => {
    const save = vi.fn(async () => "2");
    const { result } = setup({ save });
    act(() => result.current.set("a"));
    act(() => result.current.set("ab"));
    expect(result.current.value).toBe("ab");
    expect(result.current.status).toBe("pending");
    await act(() => vi.advanceTimersByTimeAsync(399));
    expect(save).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("ab", "1");
    expect(result.current.status).toBe("saved");
  });

  it("is sent when the field's owner goes away, and when the window loses focus", async () => {
    const save = vi.fn(async () => undefined);
    const a = setup({ save });
    act(() => a.result.current.set("x"));
    a.unmount();
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(save).toHaveBeenCalledWith("x", "1");
    const b = setup({ save });
    act(() => b.result.current.set("y"));
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(save).toHaveBeenLastCalledWith("y", "1");
  });

  it("keeps one save in the air per key; an edit made meanwhile leaves after it with the new version", async () => {
    let release: (v: string) => void = () => {};
    const save = vi.fn(
      (value: string, base: string | undefined) =>
        new Promise<string>((r) => {
          release = r;
          void value;
          void base;
        }),
    );
    const { result } = setup({ save });
    act(() => result.current.set("one"));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(result.current.status).toBe("saving");
    act(() => result.current.set("two"));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => release("2"));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]).toEqual(["two", "2"]);
    await act(async () => release("3"));
    expect(result.current.status).toBe("saved");
  });

  it("never drops what was typed when a save fails: the error is shown and retry sends it again", async () => {
    const save = vi.fn().mockRejectedValueOnce(new ApiError("disk full")).mockResolvedValueOnce("2");
    const { result } = setup({ save });
    act(() => result.current.set("kept"));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("disk full");
    expect(result.current.value).toBe("kept");
    await act(() => result.current.retry());
    expect(save).toHaveBeenLastCalledWith("kept", "1");
    expect(result.current.status).toBe("saved");
  });

  it("stops on a conflict with the disk; keep mine sends without a base, take the disk drops the edit", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("moved", undefined, 409, "conflict"))
      .mockResolvedValue("5");
    const { result } = setup({ save });
    act(() => result.current.set("mine"));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(result.current.status).toBe("conflict");
    act(() => result.current.set("mine2"));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(save).toHaveBeenCalledTimes(1);
    await act(() => result.current.keepMine());
    expect(save).toHaveBeenLastCalledWith("mine2", undefined);
    expect(result.current.status).toBe("saved");

    const b = setup({ save: vi.fn().mockRejectedValue(new ApiError("moved", undefined, 409, "conflict")) });
    act(() => b.result.current.set("lost"));
    await act(() => vi.advanceTimersByTimeAsync(400));
    act(() => b.result.current.takeDisk());
    expect(b.result.current.value).toBe("disk");
    expect(b.result.current.status).toBe("saved");
  });

  it("after Reload from disk, the next edit is saved over the version read again, not the one before the conflict", async () => {
    let disk = "7";
    const save = vi.fn(async (_v: string, base: string | undefined) => {
      if (base !== undefined && base !== disk) throw new ApiError("moved", undefined, 409, "conflict");
      disk = "8";
      return "8";
    });
    const h = setup({ save });
    act(() => h.result.current.set("edit"));
    h.rerender({ ...h.props, value: "theirs", base: "7", save });
    expect(h.result.current.status).toBe("conflict");
    act(() => h.result.current.takeDisk());
    h.rerender({ ...h.props, value: "theirs", base: "7", save });
    expect(h.result.current.value).toBe("theirs");
    act(() => h.result.current.set("theirs, then mine"));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(save).toHaveBeenLastCalledWith("theirs, then mine", "7");
    expect(h.result.current.status).toBe("saved");
    act(() => h.result.current.set("and again"));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(save).toHaveBeenLastCalledWith("and again", "8");
    expect(h.result.current.status).toBe("saved");
  });

  it("after a save refused as a conflict, Reload from disk takes the version the read brings back", async () => {
    let disk = "7";
    const save = vi.fn(async (_v: string, base: string | undefined) => {
      if (base !== undefined && base !== disk) throw new ApiError("moved", undefined, 409, "conflict");
      disk = "8";
      return "8";
    });
    const h = setup({ save });
    act(() => h.result.current.set("edit"));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(h.result.current.status).toBe("conflict");
    act(() => h.result.current.takeDisk());
    h.rerender({ ...h.props, value: "theirs", base: "7", save });
    act(() => h.result.current.set("mine over theirs"));
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(save).toHaveBeenLastCalledWith("mine over theirs", "7");
    expect(h.result.current.status).toBe("saved");
  });

  it("sees a change on disk under a pending edit as a conflict instead of overwriting it", async () => {
    const save = vi.fn(async () => "9");
    const h = setup({ save, delay: "blur" });
    act(() => h.result.current.set("edit"));
    h.rerender({ ...h.props, value: "theirs", base: "7", save, delay: "blur" });
    expect(h.result.current.status).toBe("conflict");
    await act(() => h.result.current.flush());
    expect(save).not.toHaveBeenCalled();
  });

  it("does not take its own save's echo for a change on disk", async () => {
    const save = vi.fn(async () => "2");
    const h = setup({ save });
    act(() => h.result.current.set("a"));
    await act(() => vi.advanceTimersByTimeAsync(400));
    act(() => h.result.current.set("ab"));
    h.rerender({ ...h.props, value: "a", base: "2", save });
    expect(h.result.current.status).toBe("pending");
  });

  it("refuses edits while read-only (Claude is working on it)", () => {
    const h = setup({ save: vi.fn(), readOnly: true });
    act(() => h.result.current.set("nope"));
    expect(h.result.current.value).toBe("disk");
    expect(h.result.current.readOnly).toBe(true);
  });

  it("keeps an unsent edit for when the screen comes back", async () => {
    const save = vi.fn(async () => undefined);
    const k = freshKey();
    const a = setup({ key: k, save, delay: "blur" });
    act(() => a.result.current.set("draft"));
    const b = setup({ key: k, save, delay: "blur" });
    expect(b.result.current.value).toBe("draft");
    a.unmount();
    b.unmount();
  });

  it("is sent before a command that reads the same file", async () => {
    const save = vi.fn(async () => undefined);
    const k: Key = ["/p", "tests.show", { id: "Tflush" }];
    const h = setup({ key: k, save, delay: "blur" });
    act(() => h.result.current.set("before push"));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        expect(save).toHaveBeenCalledWith("before push", "1");
        return new Response("{}", { status: 200 });
      }),
    );
    await act(() =>
      execute(client, "xray.plan", { id: "Tflush" } as never, {
        flushFirst: [["tests.show", { id: "Tflush" }]],
        invalidates: "none",
      }),
    );
    expect(fetch).toHaveBeenCalled();
    vi.unstubAllGlobals();
    await flushAutosaves();
  });
});

describe("clearDrafts", () => {
  it("forgets every unsent draft and every edit waiting for its save, and nothing is sent after", async () => {
    const save = vi.fn(async () => "2");
    const a = setup({ save });
    act(() => a.result.current.set("waiting"));
    const prompt: Key = ["/p", "dock.prompt", {}];
    const d = renderHook(() => useDraft(prompt, ""));
    act(() => d.result.current[1]("typed"));
    expect(pendingAutosaves()).toHaveLength(1);
    expect(d.result.current[0]).toBe("typed");
    act(() => clearDrafts());
    expect(pendingAutosaves()).toEqual([]);
    expect(a.result.current.status).toBe("saved");
    expect(d.result.current[0]).toBe("");
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(save).not.toHaveBeenCalled();
    d.unmount();
    expect(renderHook(() => useDraft(prompt, "")).result.current[0]).toBe("");
  });
});
