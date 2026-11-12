import { createInterface } from "node:readline";
import { drawing } from "./draw.ts";
import { serveFrames } from "./frames-protocol.ts";

// ponytail: the frames worker, a program of its own (the release ships it as app/frames-worker.mjs): the core starts it
// as `node frames-worker.ts` at low priority and never imports it. stdout carries the answers only, so whatever a
// library prints goes to stderr. It ends when the core closes its stdin
if (import.meta.main) {
  for (const k of ["log", "info", "debug"] as const) console[k] = console.error;
  serveFrames(
    createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY }),
    (line) => process.stdout.write(`${line}\n`),
    drawing,
  ).then(
    () => process.stdout.write("", () => process.exit(0)),
    () => process.stdout.write("", () => process.exit(1)),
  );
}
