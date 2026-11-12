import { describe, expect, it } from "vitest";
import {
  ASKS_AT_ONCE,
  type Drawing,
  type FramesAnswer,
  serveFrames,
  stopAt,
} from "../../../../src/core/lib/frames/frames-protocol.ts";
import { sleep } from "../../../../src/shared/run/work.ts";

// a pipe of lines the test writes into, read by serveFrames as the worker reads its stdin
function pipe() {
  const queue: string[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const lines: AsyncIterable<string> = {
    async *[Symbol.asyncIterator]() {
      while (true) {
        if (queue.length) yield queue.shift() as string;
        else if (closed) return;
        else await new Promise<void>((r) => (wake = r));
      }
    },
  };
  const push = (o: unknown) => {
    queue.push(typeof o === "string" ? o : JSON.stringify(o));
    wake?.();
    wake = null;
  };
  const close = () => {
    closed = true;
    wake?.();
  };
  return { lines, push, close };
}

const until = async (ok: () => boolean) => {
  for (let i = 0; i < 400 && !ok(); i++) await sleep(5);
};

function served(drawing: Partial<Drawing>) {
  const p = pipe();
  const out: FramesAnswer[] = [];
  const done = serveFrames(p.lines, (l) => out.push(JSON.parse(l)), drawing as Drawing);
  return { ...p, out, done };
}

describe("the frames worker's side of the pipe", () => {
  it("answers each ask by its id, an error as its message, and skips what is not an ask", async () => {
    const s = served({
      sharpness: async ({ files }) => files.map((f) => f.length),
      frame: async ({ src }) => {
        throw new Error(`Input file is missing: ${src}`);
      },
    });
    s.push("not json");
    s.push("");
    s.push({ op: "sharpness" });
    s.push({ id: 1, op: "sharpness", args: { files: ["a", "bcd"] } });
    s.push({ id: 2, op: "frame", args: { src: "x.jpg", out: "y.jpg" } });
    s.push({ id: 3, op: "explode", args: {} });
    s.close();
    await s.done;
    expect(s.out.sort((a, b) => a.id - b.id)).toEqual([
      { id: 1, result: [1, 3] },
      { id: 2, error: "Input file is missing: x.jpg" },
      { id: 3, error: "Unknown frames work: explode" },
    ]);
  });

  it("works on two asks at a time; the others wait their turn", async () => {
    let now = 0;
    let most = 0;
    const s = served({
      sharpness: async () => {
        most = Math.max(most, ++now);
        await sleep(30);
        now--;
        return [0];
      },
    });
    for (let id = 1; id <= 5; id++) s.push({ id, op: "sharpness", args: { files: ["f"] } });
    s.close();
    await s.done;
    expect(s.out).toHaveLength(5);
    expect(most).toBe(ASKS_AT_ONCE);
    expect(ASKS_AT_ONCE).toBe(2);
  });

  it("a cancel stops a batch at its next picture, and an ask still waiting never starts", async () => {
    const drawn: string[] = [];
    const s = served({
      sharpness: async ({ files }, stop) => {
        for (const f of files) {
          stopAt(stop);
          await sleep(20);
          drawn.push(f);
        }
        return files.map(() => 1);
      },
    });
    const files = Array.from({ length: 20 }, (_, i) => `f${i}`);
    s.push({ id: 1, op: "sharpness", args: { files } });
    s.push({ id: 2, op: "sharpness", args: { files } });
    s.push({ id: 3, op: "sharpness", args: { files: ["late"] } });
    await until(() => drawn.length >= 2);
    s.push({ id: 1, op: "cancel" });
    s.push({ id: 3, op: "cancel" });
    await until(() => s.out.length >= 2);
    s.push({ id: 2, op: "cancel" });
    s.close();
    await s.done;
    const byId = new Map(s.out.map((a) => [a.id, a]));
    expect(byId.get(1)).toEqual({ id: 1, error: "Cancelled.", cancelled: true });
    expect(byId.get(3)).toEqual({ id: 3, error: "Cancelled.", cancelled: true });
    expect(byId.get(2)).toMatchObject({ cancelled: true });
    expect(drawn).not.toContain("late");
    expect(drawn.length).toBeLessThan(20);
  });

  it("ends when its input does, once every answer is written", async () => {
    const s = served({
      sharpness: async () => {
        await sleep(50);
        return [7];
      },
    });
    s.push({ id: 9, op: "sharpness", args: { files: ["f"] } });
    s.close();
    await s.done;
    expect(s.out).toEqual([{ id: 9, result: [7] }]);
  });
});
