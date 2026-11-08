import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CancelledError,
  debounce,
  every,
  isCancelled,
  perKey,
  retry,
  scope,
  semaphore,
  sleep,
  TimeoutError,
  timeout,
} from "../../../src/shared/run/work.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const settled = async <T>(p: Promise<T>) => {
  let state: "pending" | "done" | "failed" = "pending";
  let value: unknown;
  p.then(
    (v) => {
      state = "done";
      value = v;
    },
    (e) => {
      state = "failed";
      value = e;
    },
  );
  await vi.advanceTimersByTimeAsync(0);
  return {
    get state() {
      return state;
    },
    get value() {
      return value;
    },
  };
};

describe("sleep", () => {
  it("waits the time asked", async () => {
    const s = await settled(sleep(1000));
    await vi.advanceTimersByTimeAsync(999);
    expect(s.state).toBe("pending");
    await vi.advanceTimersByTimeAsync(1);
    expect(s.state).toBe("done");
  });

  it("stops at once on a cancel, with the cancel's reason", async () => {
    const ctl = new AbortController();
    const s = await settled(sleep(1000, ctl.signal));
    ctl.abort(new CancelledError("stop"));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.state).toBe("failed");
    expect((s.value as Error).message).toBe("stop");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never starts when already cancelled", async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(sleep(10, ctl.signal)).rejects.toBeInstanceOf(CancelledError);
  });
});

describe("timeout", () => {
  it("returns the work's result in time", async () => {
    const s = await settled(timeout(1000, () => sleep(500).then(() => "ok")));
    await vi.advanceTimersByTimeAsync(500);
    expect(s.value).toBe("ok");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails with a TimeoutError and aborts the work's signal when the time is up", async () => {
    let inner: AbortSignal | undefined;
    const s = await settled(
      timeout(1000, (signal) => {
        inner = signal;
        return new Promise(() => {});
      }),
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(s.state).toBe("failed");
    expect(s.value).toBeInstanceOf(TimeoutError);
    expect(inner?.aborted).toBe(true);
  });

  it("passes a caller's cancel through to the work", async () => {
    const ctl = new AbortController();
    let inner: AbortSignal | undefined;
    const s = await settled(
      timeout(
        1000,
        (signal) => {
          inner = signal;
          return sleep(5000, signal);
        },
        ctl.signal,
      ),
    );
    ctl.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(isCancelled(s.value)).toBe(true);
    expect(inner?.aborted).toBe(true);
  });
});

describe("retry", () => {
  it("tries again after a growing delay, then succeeds", async () => {
    const times: number[] = [];
    const s = await settled(
      retry(
        async (attempt) => {
          times.push(Date.now());
          if (attempt < 3) throw new Error("busy");
          return attempt;
        },
        { tries: 5, delayMs: 100, factor: 2 },
      ),
    );
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);
    expect(s.value).toBe(3);
    expect(times[1] - times[0]).toBe(100);
    expect(times[2] - times[1]).toBe(200);
  });

  it("waits what the error asks (Retry-After) and caps the delay", async () => {
    const times: number[] = [];
    const s = await settled(
      retry(
        async (attempt) => {
          times.push(Date.now());
          if (attempt < 3) throw Object.assign(new Error("429"), { after: attempt === 1 ? 3000 : undefined });
          return "ok";
        },
        { tries: 3, delayMs: 1000, factor: 10, maxDelayMs: 1500, when: (e) => (e as { after?: number }).after ?? true },
      ),
    );
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(10000);
    expect(s.value).toBe("ok");
    expect(times[1] - times[0]).toBe(3000);
    expect(times[2] - times[1]).toBe(1500);
  });

  it("gives up when told, or after the last try", async () => {
    await expect(
      retry(() => Promise.reject(new Error("no")), { tries: 3, delayMs: 1, when: () => false }),
    ).rejects.toThrow("no");
    const s = await settled(retry(() => Promise.reject(new Error("again")), { tries: 2, delayMs: 10 }));
    await vi.advanceTimersByTimeAsync(10);
    expect((s.value as Error).message).toBe("again");
  });

  it("stops during its wait on a cancel, and never retries a cancelled work", async () => {
    const ctl = new AbortController();
    let calls = 0;
    const s = await settled(
      retry(
        () => {
          calls++;
          return Promise.reject(new Error("429"));
        },
        { tries: 5, delayMs: 60000 },
        ctl.signal,
      ),
    );
    ctl.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(isCancelled(s.value)).toBe(true);
    expect(calls).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
    let tries = 0;
    await expect(
      retry(
        () => {
          tries++;
          return Promise.reject(new CancelledError("gone"));
        },
        { tries: 5, delayMs: 1 },
      ),
    ).rejects.toThrow("gone");
    expect(tries).toBe(1);
  });
});

describe("semaphore", () => {
  it("runs at most n works at once and hands each slot to the next", async () => {
    const gate = semaphore(2);
    let active = 0;
    let most = 0;
    const work = () =>
      gate(async () => {
        active++;
        most = Math.max(most, active);
        await sleep(100);
        active--;
      });
    const all = Promise.all([work(), work(), work(), work(), work()]);
    await vi.advanceTimersByTimeAsync(300);
    await all;
    expect(most).toBe(2);
  });

  it("lets a waiter leave the queue on a cancel, and the others go on", async () => {
    const gate = semaphore(1);
    const ctl = new AbortController();
    const order: string[] = [];
    const first = gate(async () => {
      await sleep(100);
      order.push("first");
    });
    const waiter = await settled(gate(async () => order.push("cancelled"), ctl.signal));
    const last = gate(async () => order.push("last"));
    ctl.abort();
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([first, last]);
    expect(isCancelled(waiter.value)).toBe(true);
    expect(order).toEqual(["first", "last"]);
  });

  it("releases its slot when the work fails", async () => {
    const gate = semaphore(1);
    await expect(gate(() => Promise.reject(new Error("x")))).rejects.toThrow("x");
    expect(await gate(async () => "next")).toBe("next");
  });
});

describe("perKey", () => {
  it("one at a time per key, keys apart from each other; a work waiting says so", async () => {
    const lock = perKey(1);
    const order: string[] = [];
    const waited: string[] = [];
    const work = (key: string, name: string) =>
      lock(
        key,
        async () => {
          order.push(`${name} in`);
          await sleep(100);
          order.push(`${name} out`);
        },
        undefined,
        () => waited.push(name),
      );
    const all = Promise.all([work("a", "a1"), work("a", "a2"), work("b", "b1")]);
    await vi.advanceTimersByTimeAsync(200);
    await all;
    expect(order).toEqual(["a1 in", "b1 in", "a1 out", "a2 in", "b1 out", "a2 out"]);
    expect(waited).toEqual(["a2"]);
    expect(await lock("a", async () => "free again")).toBe("free again");
  });
});

describe("scope", () => {
  const cleanups = () => {
    const done: string[] = [];
    return {
      done,
      register: (s: { defer(c: () => unknown): void }) => {
        s.defer(() => done.push("a"));
        s.defer(async () => {
          await sleep(10);
          done.push("b");
        });
        s.defer(() => done.push("c"));
      },
    };
  };

  it("runs its cleanups in reverse order after a normal end", async () => {
    const c = cleanups();
    const s = await settled(
      scope(async (sc) => {
        c.register(sc);
        return 42;
      }),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect(s.value).toBe(42);
    expect(c.done).toEqual(["c", "b", "a"]);
  });

  it("runs them after an error, and the error wins over a failing cleanup", async () => {
    const c = cleanups();
    const s = await settled(
      scope(async (sc) => {
        c.register(sc);
        sc.defer(() => {
          throw new Error("cleanup failed");
        });
        throw new Error("body failed");
      }),
    );
    await vi.advanceTimersByTimeAsync(10);
    expect((s.value as Error).message).toBe("body failed");
    expect(c.done).toEqual(["c", "b", "a"]);
  });

  it("reports a failing cleanup when the body succeeded, after running the others", async () => {
    const done: string[] = [];
    await expect(
      scope(async (sc) => {
        sc.defer(() => done.push("first"));
        sc.defer(() => {
          throw new Error("cleanup failed");
        });
        return 1;
      }),
    ).rejects.toThrow("cleanup failed");
    expect(done).toEqual(["first"]);
  });

  it("ends on a cancel even when the body ignores it, after its cleanups", async () => {
    const ctl = new AbortController();
    const c = cleanups();
    let inner: AbortSignal | undefined;
    const s = await settled(
      scope(
        (sc) => {
          c.register(sc);
          inner = sc.signal;
          return new Promise(() => {});
        },
        { signal: ctl.signal },
      ),
    );
    ctl.abort();
    await vi.advanceTimersByTimeAsync(10);
    expect(isCancelled(s.value)).toBe(true);
    expect(inner?.aborted).toBe(true);
    expect(c.done).toEqual(["c", "b", "a"]);
  });

  it("ends with a TimeoutError when its time runs out, after its cleanups", async () => {
    const c = cleanups();
    const s = await settled(
      scope(
        async (sc) => {
          c.register(sc);
          await sleep(60000, sc.signal);
        },
        { timeoutMs: 1000 },
      ),
    );
    await vi.advanceTimersByTimeAsync(1010);
    expect(s.value).toBeInstanceOf(TimeoutError);
    expect(c.done).toEqual(["c", "b", "a"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never runs its body when already cancelled", async () => {
    const ctl = new AbortController();
    ctl.abort();
    let ran = false;
    await expect(
      scope(
        async () => {
          ran = true;
        },
        { signal: ctl.signal },
      ),
    ).rejects.toBeInstanceOf(CancelledError);
    expect(ran).toBe(false);
  });

  it("aborts its own signal once it ends, so work started in it stops", async () => {
    let inner: AbortSignal | undefined;
    await scope(async (sc) => {
      inner = sc.signal;
    });
    expect(inner?.aborted).toBe(true);
  });
});

describe("every", () => {
  it("ticks until stopped, by its stop function or by its signal", async () => {
    let n = 0;
    const stop = every(100, () => n++);
    await vi.advanceTimersByTimeAsync(350);
    stop();
    await vi.advanceTimersByTimeAsync(500);
    expect(n).toBe(3);
    const ctl = new AbortController();
    let m = 0;
    every(
      100,
      async () => {
        m++;
        throw new Error("a failing tick never stops the others");
      },
      ctl.signal,
    );
    await vi.advanceTimersByTimeAsync(250);
    ctl.abort();
    await vi.advanceTimersByTimeAsync(500);
    expect(m).toBe(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never ticks when its signal is already aborted", async () => {
    const ctl = new AbortController();
    ctl.abort();
    let n = 0;
    every(100, () => n++, ctl.signal);
    await vi.advanceTimersByTimeAsync(350);
    expect(n).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("debounce", () => {
  it("gathers a burst into one call after its last value", () => {
    const calls: number[][] = [];
    const d = debounce<number>(200, (b) => calls.push(b));
    d.push(1);
    vi.advanceTimersByTime(150);
    d.push(2);
    vi.advanceTimersByTime(150);
    expect(calls).toEqual([]);
    vi.advanceTimersByTime(60);
    expect(calls).toEqual([[1, 2]]);
  });

  it("calls at most maxMs apart while the burst goes on, and forgets what a cancel drops", () => {
    const calls: number[][] = [];
    const d = debounce<number>(200, (b) => calls.push(b), 1000);
    for (let i = 0; i < 12; i++) {
      d.push(i);
      vi.advanceTimersByTime(100);
    }
    expect(calls).toEqual([[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]]);
    d.cancel();
    vi.advanceTimersByTime(1000);
    expect(calls).toHaveLength(1);
  });
});
