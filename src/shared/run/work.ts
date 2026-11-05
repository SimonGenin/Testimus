export class CancelledError extends Error {
  override name = "CancelledError";
}

export class TimeoutError extends Error {
  override name = "TimeoutError";
}

export function reasonOf(signal: AbortSignal): Error {
  const r: unknown = signal.reason;
  if (r instanceof Error && r.name !== "AbortError") return r;
  return new CancelledError(typeof r === "string" && r ? r : "Cancelled.");
}

export function isCancelled(e: unknown): boolean {
  return e instanceof CancelledError || (e instanceof Error && e.name === "AbortError");
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw reasonOf(signal);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(reasonOf(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(reasonOf(signal as AbortSignal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ponytail: the work gets a signal that aborts when its caller cancels or when the time is up, and the promise settles
// at that moment even if the work ignores its signal
export function timeout<T>(ms: number, work: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
  return scope((s) => work(s.signal), { signal, timeoutMs: ms });
}

export type RetryOptions = {
  tries: number;
  delayMs: number;
  factor?: number;
  maxDelayMs?: number;
  // false: give up; true: wait the computed delay; a number: wait that many ms (a Retry-After)
  when?: (error: unknown, attempt: number) => boolean | number;
};

export async function retry<T>(
  work: (attempt: number) => Promise<T>,
  opts: RetryOptions,
  signal?: AbortSignal,
): Promise<T> {
  let delay = opts.delayMs;
  for (let attempt = 1; ; attempt++) {
    throwIfAborted(signal);
    try {
      return await work(attempt);
    } catch (e) {
      if (isCancelled(e) || attempt >= opts.tries) throw e;
      const verdict = opts.when ? opts.when(e, attempt) : true;
      if (verdict === false) throw e;
      await sleep(typeof verdict === "number" ? verdict : delay, signal);
      delay = Math.min(delay * (opts.factor ?? 2), opts.maxDelayMs ?? Number.POSITIVE_INFINITY);
    }
  }
}

export type Semaphore = <T>(work: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

// ponytail: a finished slot is handed straight to the next waiter; a waiter whose signal aborts leaves the queue
export function semaphore(n: number): Semaphore {
  let active = 0;
  const waiting: { go: () => void; stop: (e: Error) => void }[] = [];
  const release = () => {
    const next = waiting.shift();
    if (next) next.go();
    else active--;
  };
  return async <T>(work: () => Promise<T>, signal?: AbortSignal) => {
    throwIfAborted(signal);
    if (active >= n)
      await new Promise<void>((go, stop) => {
        const entry = {
          go: () => {
            signal?.removeEventListener("abort", onAbort);
            go();
          },
          stop,
        };
        const onAbort = () => {
          const i = waiting.indexOf(entry);
          if (i >= 0) waiting.splice(i, 1);
          stop(reasonOf(signal as AbortSignal));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        waiting.push(entry);
      });
    else active++;
    try {
      return await work();
    } finally {
      release();
    }
  };
}

export type Scope = {
  signal: AbortSignal;
  defer(cleanup: () => unknown): void;
};

export type ScopeOptions = { signal?: AbortSignal; timeoutMs?: number };

// ponytail: the one place resources are released — cleanups run last-in first-out whatever ends the scope (a result,
// an error, a cancel, the time running out), each one awaited, a failing one not stopping the others
export async function scope<T>(body: (s: Scope) => Promise<T>, opts: ScopeOptions = {}): Promise<T> {
  const ctl = new AbortController();
  const cleanups: (() => unknown)[] = [];
  const onAbort = () => ctl.abort(opts.signal?.reason);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped: (e: Error) => void = () => {};
  const interrupted = new Promise<never>((_, reject) => {
    stopped = reject;
  });
  interrupted.catch(() => {});
  ctl.signal.addEventListener("abort", () => stopped(reasonOf(ctl.signal)), { once: true });
  if (opts.signal?.aborted) ctl.abort(opts.signal.reason);
  else opts.signal?.addEventListener("abort", onAbort, { once: true });
  if (opts.timeoutMs !== undefined && !ctl.signal.aborted)
    timer = setTimeout(() => ctl.abort(new TimeoutError(`Timed out after ${opts.timeoutMs} ms.`)), opts.timeoutMs);
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    if (ctl.signal.aborted) throw reasonOf(ctl.signal);
    const run = body({ signal: ctl.signal, defer: (c) => cleanups.push(c) });
    run.catch(() => {});
    outcome = { ok: true, value: await Promise.race([run, interrupted]) };
  } catch (e) {
    outcome = { ok: false, error: e };
  }
  clearTimeout(timer);
  opts.signal?.removeEventListener("abort", onAbort);
  if (!ctl.signal.aborted) ctl.abort(new CancelledError("Scope ended."));
  let cleanupError: unknown;
  for (const c of cleanups.reverse()) {
    try {
      await c();
    } catch (e) {
      cleanupError ??= e;
    }
  }
  if (!outcome.ok) throw outcome.error;
  if (cleanupError !== undefined) throw cleanupError;
  return outcome.value;
}

// ponytail: a repeating tick that never keeps the process alive and stops with its signal
export function every(ms: number, tick: () => unknown, signal?: AbortSignal): () => void {
  const timer = setInterval(() => {
    try {
      const r = tick();
      if (r instanceof Promise) r.catch(() => {});
    } catch {}
  }, ms);
  timer.unref?.();
  const stop = () => clearInterval(timer);
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
  return stop;
}

// ponytail: a burst of values becomes one call `ms` after the last of them, with every value gathered
export function debounce<T>(ms: number, fire: (batch: T[]) => unknown): { push(value: T): void; cancel(): void } {
  let batch: T[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    push(value) {
      batch.push(value);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const out = batch;
        batch = [];
        try {
          const r = fire(out);
          if (r instanceof Promise) r.catch(() => {});
        } catch {}
      }, ms);
      timer.unref?.();
    },
    cancel() {
      clearTimeout(timer);
      batch = [];
    },
  };
}
