import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { env } from "../env.ts";
import type { Device, PerfLine, PerfOp, ResolvedModel, RuntimeId } from "../types.ts";

export const KEEP_DAYS = 90;
export const KEEP_LINES = 100_000;
const OPS: PerfOp[] = [
  "embed.query",
  "embed.index",
  "rerank",
  "search.bm25",
  "search.vector",
  "search.total",
  "model.load",
  "claude.run",
  "speech",
];
const STRINGS = ["model", "fingerprint", "runtime", "device", "quantization", "project", "jobId"] as const;
const NUMBERS = ["tokens", "loadMs", "peakRssMB", "vramMB"] as const;
const FLAGS = ["partialOffload", "oom"] as const;

export type PerfFields = { model: string; runtime: RuntimeId; device: Device; quantization?: string };
export type PerfScope = { fingerprint?: string; project?: string; jobId?: string };

export type PerfStat = {
  op: string;
  model: string;
  device: string;
  count: number;
  p50: number;
  p95: number;
  perSecond: number;
  peakMB: number | null;
  partialOffload: boolean;
  oom: number;
};

export function journalFile(): string {
  return join(env.localDir(), "perf", "journal.jsonl");
}

// ponytail: only known keys with the right type are written, so no document or query text can slip in
export function cleanLine(line: PerfLine): PerfLine | null {
  if (!OPS.includes(line.op) || !Number.isFinite(line.ms) || !Number.isFinite(line.items)) return null;
  const out: Record<string, unknown> = {
    at: typeof line.at === "string" && !Number.isNaN(Date.parse(line.at)) ? line.at : env.now().toISOString(),
    op: line.op,
    items: line.items,
    ms: line.ms,
  };
  for (const k of STRINGS) {
    const v = line[k];
    if (typeof v === "string" && v.length <= 300 && !v.includes("\n")) out[k] = v;
  }
  for (const k of NUMBERS) if (Number.isFinite(line[k])) out[k] = line[k];
  for (const k of FLAGS) if (typeof line[k] === "boolean") out[k] = line[k];
  return out as PerfLine;
}

let appended = 0;

export function recordPerf(line: PerfLine): void {
  const clean = cleanLine(line);
  if (!clean) return;
  try {
    const file = journalFile();
    mkdirSync(dirname(file), { recursive: true });
    if (appended++ % 500 === 0) prunePerf();
    appendFileSync(file, `${JSON.stringify(clean)}\n`);
  } catch {}
}

export function readPerf(): PerfLine[] {
  const file = journalFile();
  if (!existsSync(file)) return [];
  const out: PerfLine[] = [];
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l) as PerfLine);
    } catch {}
  }
  return out;
}

export function prunePerf(): number {
  const file = journalFile();
  if (!existsSync(file)) return 0;
  const raw = readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim());
  const since = env.now().getTime() - KEEP_DAYS * 86_400_000;
  const kept = raw.filter((l) => {
    try {
      return Date.parse((JSON.parse(l) as PerfLine).at) >= since;
    } catch {
      return false;
    }
  });
  const last = kept.slice(-KEEP_LINES);
  if (last.length !== raw.length) writeFileSync(file, last.length ? `${last.join("\n")}\n` : "");
  return raw.length - last.length;
}

type OpState = { tokens: number; loadMs: number; partialOffload?: boolean; oomLogged?: boolean };
const scopes = new AsyncLocalStorage<PerfScope>();
const ops = new AsyncLocalStorage<OpState>();

export function perfScope(): PerfScope {
  return scopes.getStore() ?? {};
}

const cancels = new AsyncLocalStorage<AbortSignal>();

// ponytail: the runtimes' seam carries no signal; a job's cancel reaches a model load through its scope
export function withPerfScope<T>(scope: PerfScope, fn: () => T, signal?: AbortSignal): T {
  const merged = { ...perfScope() };
  for (const [k, v] of Object.entries(scope)) if (v) merged[k as keyof PerfScope] = v;
  return signal ? cancels.run(signal, () => scopes.run(merged, fn)) : scopes.run(merged, fn);
}

export function opSignal(): AbortSignal | undefined {
  return cancels.getStore();
}

export function perfFields(m: ResolvedModel): PerfFields {
  const device: Device = m.runtime === "transformers" && m.device === "gpu" ? "dml" : m.device;
  const by = m.entry.dtypeByDevice ?? {};
  return {
    model: m.entry.id,
    runtime: env.mock ? "mock" : m.runtime,
    device,
    quantization: m.dtype ?? by[device] ?? (m.runtime === "transformers" ? by.cpu : undefined) ?? m.entry.quantization,
  };
}

export function addTokens(n: number): void {
  const s = ops.getStore();
  if (s && Number.isFinite(n)) s.tokens += n;
}

const MEMORY =
  /out of memory|outofmemory|e_outofmemory|0x8007000e|bad_alloc|failed to allocate|unable to allocate|cannot allocate|could not allocate|alloc(ation)? failed|enomem|not enough memory|insufficient memory|requires more (system )?memory|cudamalloc|memory allocation/i;

export function isMemoryError(e: unknown): boolean {
  const text = e instanceof Error ? `${e.message} ${String((e as { cause?: unknown }).cause ?? "")}` : String(e);
  return MEMORY.test(text);
}

export function peakRssMB(): number {
  return Math.round(process.resourceUsage().maxRSS / 1024);
}

function line(op: PerfOp, f: PerfFields, items: number, ms: number, extra: Partial<PerfLine> = {}): PerfLine {
  return { at: env.now().toISOString(), op, ...f, ...perfScope(), items, ms: Math.max(0, Math.round(ms)), ...extra };
}

// ponytail: a model loaded inside an operation is timed apart, so the first query's p95 is not the load
export async function timeOp<T>(op: PerfOp, f: PerfFields, items: number, fn: () => Promise<T>): Promise<T> {
  const state: OpState = { tokens: 0, loadMs: 0 };
  const t0 = performance.now();
  try {
    const out = await ops.run(state, fn);
    const ms = performance.now() - t0 - state.loadMs;
    recordPerf(
      line(op, f, items, ms, {
        ...(state.tokens ? { tokens: state.tokens } : {}),
        ...(state.loadMs ? { loadMs: Math.round(state.loadMs) } : {}),
        ...(state.partialOffload !== undefined ? { partialOffload: state.partialOffload } : {}),
      }),
    );
    return out;
  } catch (e) {
    if (isMemoryError(e) && !state.oomLogged)
      recordPerf(line(op, f, 0, performance.now() - t0 - state.loadMs, { oom: true }));
    throw e;
  }
}

export function currentOp(): OpState | undefined {
  return ops.getStore();
}

export function loadFailedForMemory(f: PerfFields, ms: number, target: OpState | undefined = ops.getStore()): void {
  if (target) target.oomLogged = true;
  recordPerf(line("model.load", f, 0, ms, { loadMs: Math.max(0, Math.round(ms)), oom: true }));
}

let loadTotal = 0;

export function loadMsSoFar(): number {
  return loadTotal;
}

// ponytail: a load another process timed (the embed worker) counts as if it had run here
export function loadTimed(
  f: PerfFields,
  ms: number,
  outcome: { extra?: Partial<PerfLine> } | { error: unknown },
  target: OpState | undefined = ops.getStore(),
): void {
  loadTotal += ms;
  if (target) target.loadMs += ms;
  if ("error" in outcome) {
    if (isMemoryError(outcome.error)) loadFailedForMemory(f, ms, target);
    return;
  }
  recordPerf(line("model.load", f, 1, ms, { loadMs: Math.round(ms), ...outcome.extra }));
}

export async function timeLoad<T>(
  f: PerfFields,
  fn: () => Promise<T>,
  measure: (result: T) => Partial<PerfLine> | Promise<Partial<PerfLine>> = () => ({}),
  target: OpState | undefined = ops.getStore(),
): Promise<T> {
  const t0 = performance.now();
  try {
    const out = await fn();
    const ms = performance.now() - t0;
    loadTotal += ms;
    if (target) target.loadMs += ms;
    let extra: Partial<PerfLine> = {};
    try {
      extra = await measure(out);
    } catch {}
    recordPerf(line("model.load", f, 1, ms, { loadMs: Math.round(ms), ...extra }));
    if (target && extra.partialOffload !== undefined) target.partialOffload = extra.partialOffload;
    return out;
  } catch (e) {
    const ms = performance.now() - t0;
    loadTotal += ms;
    if (target) target.loadMs += ms;
    if (isMemoryError(e)) loadFailedForMemory(f, ms, target);
    throw e;
  }
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export function perfStats(opts: { model?: string; last?: number; lines?: PerfLine[] } = {}): PerfStat[] {
  const groups = new Map<string, PerfLine[]>();
  for (const l of opts.lines ?? readPerf()) {
    if (opts.model && l.model !== opts.model) continue;
    const key = `${l.op}\u0000${l.model ?? ""}\u0000${l.device ?? ""}`;
    const g = groups.get(key) ?? [];
    g.push(l);
    groups.set(key, g);
  }
  const out: PerfStat[] = [];
  for (const [key, all] of groups) {
    const window = opts.last ? all.slice(-opts.last) : all;
    const g = window.filter((l) => !l.oom);
    const [op, model, device] = key.split("\u0000");
    const ms = g.map((l) => l.ms).sort((a, b) => a - b);
    const totalMs = ms.reduce((a, b) => a + b, 0);
    const items = g.reduce((a, l) => a + l.items, 0);
    const peaks = g.map((l) => Math.max(l.peakRssMB ?? 0, l.vramMB ?? 0)).filter((v) => v > 0);
    out.push({
      op,
      model,
      device,
      count: g.length,
      p50: pct(ms, 50),
      p95: pct(ms, 95),
      perSecond: totalMs > 0 ? Math.round((items / totalMs) * 1000 * 10) / 10 : 0,
      peakMB: peaks.length ? Math.max(...peaks) : null,
      partialOffload: g.some((l) => l.partialOffload === true),
      oom: window.length - g.length,
    });
  }
  return out.sort((a, b) => a.op.localeCompare(b.op) || a.model.localeCompare(b.model));
}

export function measuredMB(model: string, lines?: PerfLine[]): { vram: number | null; ram: number | null } {
  let vram: number | null = null;
  let ram: number | null = null;
  for (const l of lines ?? readPerf()) {
    if (l.model !== model || l.oom) continue;
    if (l.vramMB && !l.partialOffload) vram = Math.max(vram ?? 0, l.vramMB);
    if (l.peakRssMB) ram = Math.max(ram ?? 0, l.peakRssMB);
  }
  return { vram, ram };
}

export function memoryFailures(model: string, lines: PerfLine[], last = 50): number {
  return lines
    .filter((l) => l.model === model)
    .slice(-last)
    .filter((l) => l.oom).length;
}

function busiest(stats: PerfStat[], model: string, op: string): PerfStat | undefined {
  return stats.filter((s) => s.model === model && s.op === op && s.count > 0).sort((a, b) => b.count - a.count)[0];
}

const msText = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`);

export function speedLine(model: string, stats: PerfStat[]): string | undefined {
  const q = busiest(stats, model, "embed.query");
  const r = busiest(stats, model, "rerank");
  const i = busiest(stats, model, "embed.index");
  const parts = [
    ...(q ? [`query ${msText(q.p50)}`] : []),
    ...(r ? [`rerank ${msText(r.p50)}`] : []),
    ...(i ? [`index ${i.perSecond} passages/s`] : []),
  ];
  return parts.length ? `on this PC: ${parts.join(", ")}` : undefined;
}

export function variantSpeed(embedding: string, reranker: string | null, stats: PerfStat[]): string | undefined {
  const parts = [speedLine(embedding, stats), reranker ? speedLine(reranker, stats) : undefined]
    .filter((s): s is string => !!s)
    .map((s) => s.replace(/^on this PC: /, ""));
  return parts.length ? `on this PC: ${parts.join(", ")}` : undefined;
}
