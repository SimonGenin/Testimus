import { describe, expect, it } from "vitest";
import {
  type EmbedAnswer,
  type Engine,
  serveEmbeds,
  vectorOf,
  vectorText,
} from "../../../../../src/core/rag/runtimes/embed-protocol.ts";
import type { EmbedSpec } from "../../../../../src/core/rag/runtimes/transformers-engine.ts";
import { fakeEngine, fakeVector } from "../../../helpers/fake-embed-worker.ts";

const spec = (path = "D:/models/org/m"): EmbedSpec => ({
  path,
  device: "cpu",
  dtype: "q8",
  pooling: "cls",
  normalize: true,
  maxInputTokens: 8192,
});

// ponytail: the worker's stdin as a queue the test writes to; ending it ends serveEmbeds once every answer is out
function pipe() {
  const queue: (string | null)[] = [];
  let wake: (() => void) | null = null;
  const answers: EmbedAnswer[] = [];
  const waiting: { id: number; done: (a: EmbedAnswer) => void }[] = [];
  return {
    lines: (async function* () {
      for (;;) {
        while (!queue.length) await new Promise<void>((r) => (wake = r));
        const l = queue.shift() as string | null;
        if (l === null) return;
        yield l;
      }
    })(),
    send(o: unknown) {
      queue.push(typeof o === "string" ? o : JSON.stringify(o));
      wake?.();
    },
    end() {
      queue.push(null);
      wake?.();
    },
    write(line: string) {
      const a = JSON.parse(line) as EmbedAnswer;
      answers.push(a);
      for (const w of waiting.filter((x) => x.id === a.id)) w.done(a);
    },
    answer(id: number): Promise<EmbedAnswer> {
      const had = answers.find((a) => a.id === id);
      return had ? Promise.resolve(had) : new Promise((done) => waiting.push({ id, done }));
    },
    answers,
  };
}

function serve(engine: Engine<{ path: string }> = fakeEngine) {
  const p = pipe();
  const served = serveEmbeds(p.lines, (l) => p.write(l), engine, { intra: 6, inter: 1 });
  return { ...p, served };
}

describe("embed worker protocol", () => {
  it("a vector crosses the pipe exactly, as the base64 of its float32 bytes", () => {
    const v = new Float32Array([0.1, -1e-30, 3.4028234663852886e38, Number.MIN_VALUE, 1 / 3]);
    expect(Array.from(vectorOf(vectorText(v)))).toEqual(Array.from(v));
    const slice = new Float32Array([9, 8, 7, 6]).subarray(1, 3);
    expect(Array.from(vectorOf(vectorText(slice)))).toEqual([8, 7]);
  });

  it("answers each batch by its id, with the tokens, the model's limit and the load on the first only", async () => {
    const w = serve();
    w.send({ id: 1, op: "embed", spec: spec(), inputs: ["un deux", "trois"] });
    w.send({ id: 2, op: "embed", spec: spec(), inputs: ["quatre"] });
    const [a, b] = await Promise.all([w.answer(1), w.answer(2)]);
    expect(a).toMatchObject({ id: 1, tokens: 3, maxTokens: 8192 });
    if (!("vectors" in a) || !("vectors" in b)) throw new Error("no vectors");
    expect(a.vectors.map((t) => Array.from(vectorOf(t)))).toEqual([
      Array.from(fakeVector("un deux")),
      Array.from(fakeVector("trois")),
    ]);
    expect(Array.from(vectorOf(b.vectors[0]))).toEqual(Array.from(fakeVector("quatre")));
    expect([a.load, b.load].filter(Boolean)).toHaveLength(1);
    expect(a.load?.ms ?? b.load?.ms).toBeGreaterThanOrEqual(0);
    w.end();
    await w.served;
  });

  it("asks run side by side: a query is not held behind a long batch", async () => {
    const w = serve();
    w.send({ id: 1, op: "embed", spec: spec(), inputs: ["warm"] });
    await w.answer(1);
    w.send({ id: 2, op: "embed", spec: spec(), inputs: ["slow a", "slow b", "slow c"] });
    w.send({ id: 3, op: "embed", spec: spec(), inputs: ["query"] });
    await w.answer(3);
    expect(w.answers.map((a) => a.id)).toEqual([1, 3]);
    await w.answer(2);
    w.end();
    await w.served;
  });

  it("an error is that ask's answer, and the worker goes on; a load that fails says it with its time", async () => {
    const w = serve();
    w.send({ id: 1, op: "embed", spec: spec(), inputs: ["fine", "oom"] });
    w.send({ id: 2, op: "embed", spec: spec("D:/models/org/badload"), inputs: ["x"] });
    expect(await w.answer(1)).toMatchObject({ id: 1, error: "bad_alloc while embedding" });
    expect(await w.answer(2)).toMatchObject({ id: 2, error: /Failed to allocate/, load: { failed: true } });
    w.send("not json");
    w.send({ id: 3, op: "nothing" });
    w.send({ id: 4, op: "embed", spec: spec(), inputs: ["after"] });
    expect(await w.answer(4)).toMatchObject({ id: 4, tokens: 1 });
    expect(w.answers.map((a) => a.id)).toEqual([1, 2, 4]);
    w.end();
    await w.served;
  });

  it("a cancel stops the ask between two batches and says so", async () => {
    const w = serve();
    w.send({ id: 1, op: "embed", spec: spec(), inputs: ["slow 1", "slow 2", "slow 3", "slow 4", "slow 5"] });
    w.send({ id: 1, op: "cancel" });
    expect(await w.answer(1)).toMatchObject({ id: 1, error: "Embedding cancelled.", cancelled: true });
    w.end();
    await w.served;
  });

  it("another model replaces the one held once nothing uses it, and the end waits for the answers under way", async () => {
    const disposed: string[] = [];
    const loads: string[] = [];
    const w = serve({
      ...fakeEngine,
      load: async (s, t) => {
        loads.push(`${s.path}@${t.intra}/${t.inter}`);
        return fakeEngine.load(s, t);
      },
      dispose: async (l) => {
        disposed.push(l.path);
      },
    });
    w.send({ id: 1, op: "embed", spec: spec("D:/a"), inputs: ["x"] });
    await w.answer(1);
    w.send({ id: 2, op: "embed", spec: spec("D:/b"), inputs: ["slow"] });
    w.end();
    await w.served;
    expect(w.answers.map((a) => a.id)).toEqual([1, 2]);
    expect(loads).toEqual(["D:/a@6/1", "D:/b@6/1"]);
    expect(disposed).toEqual(["D:/a"]);
  });
});
