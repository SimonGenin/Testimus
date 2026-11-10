import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { awake, CancelledError, TimeoutError, watch } from "../../../src/shared/run/work.ts";

const HOUR = 3_600_000;
let slept = 0;
const now = () => Date.now() + slept;
// ponytail: a PC that sleeps runs no timer while its clock goes on — the clock jumps, then the timers tick again
const sleepFor = (ms: number) => {
  slept += ms;
};

beforeEach(() => {
  vi.useFakeTimers();
  slept = 0;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("watch", () => {
  it("aborts with a TimeoutError once nothing was heard for the time given, and each beat starts the wait again", async () => {
    const quiet = watch(8000, undefined, now);
    await vi.advanceTimersByTimeAsync(8000);
    expect(quiet.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(quiet.signal.aborted).toBe(true);
    expect(quiet.signal.reason).toBeInstanceOf(TimeoutError);
    expect(quiet.slept()).toBe(false);

    const busy = watch(8000, undefined, now);
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(6000);
      busy.beat();
    }
    expect(busy.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(busy.signal.aborted).toBe(true);
  });

  it("a PC that slept is not stuck: the clock jumped, the wait starts over", async () => {
    const w = watch(8000, undefined, now);
    await vi.advanceTimersByTimeAsync(6000);
    sleepFor(HOUR);
    await vi.advanceTimersByTimeAsync(2000);
    expect(w.signal.aborted).toBe(false);
    expect(w.slept()).toBe(true);
    await vi.advanceTimersByTimeAsync(6000);
    expect(w.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(4000);
    expect(w.signal.aborted).toBe(true);
    expect(w.signal.reason).toBeInstanceOf(TimeoutError);
  });

  it("follows its caller's cancel with the caller's reason, and looks no more once stopped", async () => {
    const caller = new AbortController();
    const w = watch(8000, caller.signal, now);
    caller.abort(new CancelledError("Stopped by the user."));
    expect(w.signal.aborted).toBe(true);
    expect((w.signal.reason as Error).message).toBe("Stopped by the user.");

    const stopped = watch(8000, undefined, now);
    stopped.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(stopped.signal.aborted).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("awake", () => {
  const never = (signal: AbortSignal) =>
    new Promise<never>((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));

  it("gives the work's result, and ends it with a TimeoutError when its time awake is up", async () => {
    await expect(awake(8000, async () => "done", undefined, now)).resolves.toBe("done");
    const stuck = awake(8000, never, undefined, now);
    const failed = expect(stuck).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sleep does not use the time up: the wait starts over at the wake", async () => {
    let done: (v: string) => void = () => {};
    const work = awake(8000, () => new Promise<string>((r) => (done = r)), undefined, now);
    await vi.advanceTimersByTimeAsync(6000);
    sleepFor(8 * HOUR);
    await vi.advanceTimersByTimeAsync(7000);
    done("heard");
    await expect(work).resolves.toBe("heard");
  });

  it("work that failed across a sleep is started over; a failure awake is the work's own", async () => {
    let tries = 0;
    const work = awake(
      8000,
      async () => {
        tries++;
        if (tries > 1) return "second try";
        await vi.advanceTimersByTimeAsync(2000);
        sleepFor(HOUR);
        await vi.advanceTimersByTimeAsync(2000);
        throw new Error("the connection was cut");
      },
      undefined,
      now,
    );
    await expect(work).resolves.toBe("second try");
    expect(tries).toBe(2);

    const failing = awake(
      8000,
      async () => {
        throw new Error("refused");
      },
      undefined,
      now,
    );
    await expect(failing).rejects.toThrow("refused");
  });

  it("a cancel is a cancel, never a time limit nor a new try", async () => {
    const caller = new AbortController();
    let tries = 0;
    const work = awake(
      8000,
      (signal) => {
        tries++;
        return never(signal);
      },
      caller.signal,
      now,
    );
    const failed = expect(work).rejects.toBeInstanceOf(CancelledError);
    await vi.advanceTimersByTimeAsync(2000);
    sleepFor(HOUR);
    await vi.advanceTimersByTimeAsync(2000);
    caller.abort();
    await failed;
    expect(tries).toBe(1);
  });
});
