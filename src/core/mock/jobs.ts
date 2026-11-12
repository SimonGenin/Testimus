import { startJob } from "../jobs.ts";

// ponytail: TESTIMUS_MOCK_JOBS=<n> — a folder import of n conversions held under way at the start, as on 2026-11-10:
// about 60 % done, 10 % converting, the rest queued; Cancel on the import stops them all. The pages are seen at that
// scale (the top bar's activity, the job panel) without converting anything
export function mockBatch(project: string | null, n: number): void {
  if (!project || !(n > 0)) return;
  const held = (signal: AbortSignal) => new Promise((r) => signal.addEventListener("abort", r, { once: true }));
  startJob(
    "docs.add",
    "D401-1 Specifications Fonctionnelles - J5",
    project,
    async (ctx) => {
      ctx.steps?.([
        { id: "copy", label: "Copy the files" },
        { id: "convert", label: "Convert the documents" },
      ]);
      ctx.step?.("copy");
      ctx.step?.("convert");
      const done = Math.round(n * 0.6);
      const running = Math.max(1, Math.round(n * 0.1));
      const kids = Array.from({ length: n }, (_, i) =>
        startJob(
          "docs.convert",
          `SOSIE_211_D401-1_${i + 1}`,
          project,
          async (k) => {
            if (i < done) return {};
            if (i < done + running) k.progress({ message: `Reading page ${(i % 9) + 1}`, done: i % 9, total: 12 });
            else {
              k.steps?.([{ id: "queue", label: "Wait for the other conversions" }]);
              k.step?.("queue");
              k.progress({ message: "Waiting to convert (5 at a time)" });
            }
            await held(k.signal);
            return { cancelled: true };
          },
          ctx.signal,
          { label: `SOSIE_211_D401-1_${i + 1}` },
        ).done.catch(() => {}),
      );
      ctx.progress({ message: `Converted ${done} of ${n}`, done, total: n });
      await Promise.all(kids);
      return { cancelled: true };
    },
    undefined,
    { label: "D401-1 Specifications Fonctionnelles - J5" },
  );
}
