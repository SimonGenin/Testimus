import { createInterface } from "node:readline";
import { type Engine, serveEmbeds } from "../../../src/core/rag/runtimes/embed-protocol.ts";
import { sleep } from "../../../src/shared/run/work.ts";

// A stand-in for src/core/rag/runtimes/embed-worker.ts: the same protocol (serveEmbeds), a made-up model. A text
// says what to do: « oom » fails, « crash » ends the process, « slow » takes 100 ms; a path with « badload » fails
// to load. Its vectors are fakeVector's, so a test computes the same ones in its own process.

export function fakeVector(text: string, dims = 8): Float32Array {
  const v = new Float32Array(dims);
  for (let i = 0; i < text.length; i++) v[(text.charCodeAt(i) * 31 + i) % dims] += 1 / (i + 1.37);
  return v;
}

export const fakeEngine: Engine<{ path: string }> = {
  load: async (spec) => {
    await sleep(20);
    if (spec.path.includes("badload")) throw new Error("Failed to allocate memory for requested buffer of size 1");
    return { path: spec.path };
  },
  embed: async (_l, _spec, inputs, stop) => {
    const vectors: Float32Array[] = [];
    for (const t of inputs) {
      if (stop()) throw new Error("Embedding cancelled.");
      if (t.includes("crash")) process.exit(3);
      if (t.includes("oom")) throw new Error("bad_alloc while embedding");
      if (t.includes("slow")) await sleep(100);
      vectors.push(fakeVector(t));
    }
    return { vectors, tokens: inputs.join(" ").split(/\s+/).length, maxTokens: 8192 };
  },
};

if (import.meta.main) {
  const at = process.argv.indexOf("--threads");
  process.stderr.write(`fake worker, threads ${process.argv[at + 1]}\n`);
  serveEmbeds(
    createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY }),
    (line) => process.stdout.write(`${line}\n`),
    fakeEngine,
    { intra: Number(process.argv[at + 1]), inter: 1 },
  ).then(() => process.stdout.write("", () => process.exit(0)));
}
