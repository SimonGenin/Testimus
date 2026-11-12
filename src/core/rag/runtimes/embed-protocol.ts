import type { EmbedSpec, Threads } from "./transformers-engine.ts";

export type EmbedAsk = { id: number; op: "embed"; spec: EmbedSpec; inputs: string[] } | { id: number; op: "cancel" };
export type EmbedLoad = { ms: number; peakRssMB?: number; failed?: true };
export type EmbedAnswer =
  | { id: number; vectors: string[]; tokens: number; maxTokens: number; load?: EmbedLoad }
  | { id: number; error: string; cancelled?: true; load?: EmbedLoad };

export type Engine<L> = {
  load(spec: EmbedSpec, threads: Threads): Promise<L>;
  embed(
    loaded: L,
    spec: EmbedSpec,
    inputs: string[],
    stop: () => boolean,
  ): Promise<{ vectors: Float32Array[]; tokens: number; maxTokens: number }>;
  dispose?(loaded: L): Promise<void>;
};

// ponytail: a vector crosses the pipe as the base64 of its float32 bytes — exact, a quarter of its decimal text
export function vectorText(v: Float32Array): string {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
}

export function vectorOf(text: string): Float32Array {
  const bytes = Buffer.from(text, "base64");
  const v = new Float32Array(bytes.byteLength / 4);
  new Uint8Array(v.buffer).set(bytes);
  return v;
}

function keyOf(spec: EmbedSpec): string {
  return [spec.path, spec.device, spec.dtype ?? ""].join("|");
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const peakRssMB = () => Math.round(process.resourceUsage().maxRSS / 1024);

// ponytail: the embed worker's side of the pipe — one JSON line in, one out, matched by id; asks run side by side (a
// query is not held behind an index batch), a cancel is honoured between two batches, a model other than the one
// held replaces it once nothing uses it. It ends when its input does, once every answer is written
export async function serveEmbeds<L>(
  lines: AsyncIterable<string>,
  write: (line: string) => void,
  engine: Engine<L>,
  threads: Threads,
): Promise<void> {
  const models = new Map<string, { loaded: Promise<L>; users: number }>();
  const cancelled = new Set<number>();
  const running = new Set<Promise<void>>();
  const answer = (a: EmbedAnswer) => write(JSON.stringify(a));

  async function embed(ask: Extract<EmbedAsk, { op: "embed" }>): Promise<void> {
    const key = keyOf(ask.spec);
    let held = models.get(key);
    let load: EmbedLoad | undefined;
    if (!held) {
      for (const [k, other] of models)
        if (!other.users) {
          models.delete(k);
          other.loaded.then((l) => engine.dispose?.(l)).catch(() => {});
        }
      const t0 = performance.now();
      const mine = { loaded: engine.load(ask.spec, threads), users: 1 };
      models.set(key, mine);
      try {
        await mine.loaded;
        load = { ms: Math.round(performance.now() - t0), peakRssMB: peakRssMB() };
      } catch (e) {
        if (models.get(key) === mine) models.delete(key);
        answer({ id: ask.id, error: messageOf(e), load: { ms: Math.round(performance.now() - t0), failed: true } });
        return;
      }
      held = mine;
    } else held.users++;
    try {
      const out = await engine.embed(await held.loaded, ask.spec, ask.inputs, () => cancelled.has(ask.id));
      answer({
        id: ask.id,
        vectors: out.vectors.map(vectorText),
        tokens: out.tokens,
        maxTokens: out.maxTokens,
        ...(load ? { load } : {}),
      });
    } catch (e) {
      answer({
        id: ask.id,
        error: messageOf(e),
        ...(cancelled.has(ask.id) ? { cancelled: true as const } : {}),
        ...(load ? { load } : {}),
      });
    } finally {
      held.users--;
      cancelled.delete(ask.id);
    }
  }

  for await (const line of lines) {
    if (!line.trim()) continue;
    let ask: EmbedAsk;
    try {
      ask = JSON.parse(line) as EmbedAsk;
    } catch {
      continue;
    }
    if (ask?.op === "cancel") {
      cancelled.add(ask.id);
      continue;
    }
    if (ask?.op !== "embed") continue;
    const p = embed(ask).catch((e) => answer({ id: ask.id, error: messageOf(e) }));
    running.add(p);
    p.finally(() => running.delete(p));
  }
  await Promise.allSettled([...running]);
}
