import type { ProbeDeps, ProbeWorker } from "../claude/limits.ts";

// ponytail: --mock tests a PC where each agent adds 7.5 % of CPU and 850 MB — the CPU stops it at 11, the limit is 10
export function mockProbeDeps(stepMs = 40): ProbeDeps {
  let running = 0;
  let idle = 0;
  let total = 0;
  const cpu = () => 0.06 + 0.075 * running;
  const worker = (): ProbeWorker => {
    running++;
    let on = true;
    return {
      ready: Promise.resolve(),
      searches: () => (on ? [240 + 15 * running] : []),
      failure: () => null,
      stop() {
        if (on) running--;
        on = false;
      },
    };
  };
  return {
    start: worker,
    cpus() {
      total += 1000;
      idle += 1000 * (1 - cpu());
      return { idle, total };
    },
    freeMB: () => 15000 - 850 * running,
    sleep: (ms, signal) =>
      new Promise((r) => {
        const t = setTimeout(r, Math.min(ms, stepMs));
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            r();
          },
          { once: true },
        );
      }),
    now: () => Date.now(),
    windowMs: 6000,
    readyMs: 120000,
  };
}
