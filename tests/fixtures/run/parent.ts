import { join } from "node:path";
import { killChildren, killChildrenOnExit, onParentGone, start } from "../../../src/shared/run/process.ts";

killChildrenOnExit();
const tree = start({
  exe: process.execPath,
  args: [join(import.meta.dirname, "tree.mjs"), "hang"],
  onLine: (line) => process.stdout.write(`${line}\n`),
});
onParentGone(process.stdin, () => {
  killChildren();
  process.exit(0);
});
await tree.exited;
