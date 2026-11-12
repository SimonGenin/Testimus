import { createInterface } from "node:readline";
import { type Engine, serveEmbeds } from "./embed-protocol.ts";
import { embedLoaded, type Loaded, loadModel } from "./transformers-engine.ts";

export const transformersEngine: Engine<Loaded> = {
  load: (spec, threads) => loadModel(spec.path, "embedding", spec.dtype, spec.device, threads),
  embed: embedLoaded,
  dispose: (l) => l.dispose(),
};

// ponytail: the embed worker, a program of its own (the release ships it as app/embed-worker.mjs): the core starts it
// as `node embed-worker.ts --threads <n>` and never imports it. stdout carries the answers only, so whatever a library
// prints goes to stderr; one inter-op thread, the graph of an embedding model being a chain. It ends when the core
// closes its stdin
if (import.meta.main) {
  const at = process.argv.indexOf("--threads");
  const n = at > 0 ? Number(process.argv[at + 1]) : Number.NaN;
  for (const k of ["log", "info", "debug"] as const) console[k] = console.error;
  serveEmbeds(
    createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY }),
    (line) => process.stdout.write(`${line}\n`),
    transformersEngine,
    { intra: Number.isInteger(n) && n > 0 ? n : 1, inter: 1 },
  ).then(
    () => process.stdout.write("", () => process.exit(0)),
    () => process.stdout.write("", () => process.exit(1)),
  );
}
