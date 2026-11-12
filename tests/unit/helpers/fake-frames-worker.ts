import { basename } from "node:path";
import { createInterface } from "node:readline";
import { drawing } from "../../../src/core/lib/frames/draw.ts";
import { type Drawing, serveFrames, stopAt } from "../../../src/core/lib/frames/frames-protocol.ts";
import { sleep } from "../../../src/shared/run/work.ts";

// A stand-in for src/core/lib/frames/frames-worker.ts: the same protocol (serveFrames) and the real drawing, but a
// sharpness asked of a file named « slow… » takes 100 ms and is 1, of one named « crash… » ends the process (exit 3),
// of one named « fail… » throws. Each picture done is said on stderr (« drew <name> »), so a test sees where it stopped.

export const fakeDrawing: Drawing = {
  ...drawing,
  sharpness: async ({ files }, stop) => {
    const out: number[] = [];
    for (const f of files) {
      stopAt(stop);
      const name = basename(f);
      if (name.startsWith("crash")) process.exit(3);
      if (name.startsWith("fail")) throw new Error(`Input file is missing: ${f}`);
      if (name.startsWith("slow")) await sleep(100);
      out.push(name.startsWith("slow") ? 1 : (await drawing.sharpness({ files: [f] }, stop))[0]);
      process.stderr.write(`drew ${name}\n`);
    }
    return out;
  },
};

if (import.meta.main) {
  process.stderr.write("fake frames worker\n");
  serveFrames(
    createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY }),
    (line) => process.stdout.write(`${line}\n`),
    fakeDrawing,
  ).then(() => process.stdout.write("", () => process.exit(0)));
}
