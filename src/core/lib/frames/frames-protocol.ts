import { semaphore } from "../../../shared/run/work.ts";

export const MOSAIC_SIDE = 3;

export type Box = [x: number, y: number, w: number, h: number];
export type Size = { width: number; height: number };
export type Tile = { at: number; file: string; box?: Box };

// ponytail: what the frames worker does, each with what it is given and what it answers — paths in, a little out: the
// pictures are read and written by the worker, never carried by the pipe
export type FrameOps = {
  sharpness: { in: { files: string[] }; out: number[] };
  distinct: { in: { files: string[] }; out: { i: number; box?: Box }[] };
  crop: { in: { file: string; box: Box; out: string }; out: Size | null };
  mosaic: { in: { tiles: Tile[]; out: string; first: number }; out: null };
  frame: { in: { src: string; out: string }; out: Size };
  picture: { in: { src: string; out: string }; out: Size & { takenAt?: string } };
};
export type FrameOp = keyof FrameOps;

export type FramesAsk = { id: number; op: FrameOp; args: unknown } | { id: number; op: "cancel" };
export type FramesAnswer = { id: number; result: unknown } | { id: number; error: string; cancelled?: true };

export type Drawing = {
  [K in FrameOp]: (args: FrameOps[K]["in"], stop: () => boolean) => Promise<FrameOps[K]["out"]>;
};

export const ASKS_AT_ONCE = 2;

export class Stopped extends Error {}

// ponytail: a batch looks at its cancel before each picture
export function stopAt(stop: () => boolean): void {
  if (stop()) throw new Stopped("Cancelled.");
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ponytail: the frames worker's side of the pipe — one JSON line in, one out, matched by id; two asks at a time (videos
// converting side by side wait their turn here, not in the core), a cancel honoured at the next picture of the ask. It
// ends when its input does, once every answer is written
export async function serveFrames(
  lines: AsyncIterable<string>,
  write: (line: string) => void,
  drawing: Drawing,
): Promise<void> {
  const cancelled = new Set<number>();
  const running = new Set<Promise<void>>();
  const slot = semaphore(ASKS_AT_ONCE);
  const answer = (a: FramesAnswer) => write(JSON.stringify(a));

  async function serve(ask: { id: number; op: FrameOp; args: unknown }): Promise<void> {
    const stop = () => cancelled.has(ask.id);
    const work = drawing[ask.op] as (args: unknown, stop: () => boolean) => Promise<unknown>;
    try {
      const result = await slot(() => {
        stopAt(stop);
        return work(ask.args, stop);
      });
      answer({ id: ask.id, result });
    } catch (e) {
      answer({
        id: ask.id,
        error: messageOf(e),
        ...(stop() || e instanceof Stopped ? { cancelled: true as const } : {}),
      });
    } finally {
      cancelled.delete(ask.id);
    }
  }

  for await (const line of lines) {
    if (!line.trim()) continue;
    let ask: FramesAsk;
    try {
      ask = JSON.parse(line) as FramesAsk;
    } catch {
      continue;
    }
    if (typeof ask?.id !== "number") continue;
    if (ask.op === "cancel") {
      cancelled.add(ask.id);
      continue;
    }
    if (!Object.hasOwn(drawing, ask.op)) {
      answer({ id: ask.id, error: `Unknown frames work: ${String(ask.op)}` });
      continue;
    }
    const p = serve(ask);
    running.add(p);
    p.finally(() => running.delete(p));
  }
  await Promise.allSettled([...running]);
}
