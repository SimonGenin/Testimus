import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const UI = join(import.meta.dirname, "..", "..", "..", "..", "src", "ui");

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? files(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : [],
  );
}

// ponytail: READY.md « no italics … in the interface » — Word's italics inside a document's text are content (an <em>
// from the converted markdown), never a style of the interface
describe("Claude and sources draw no italics (design READY.md, gaps point 10)", () => {
  it.each(["components/claude", "components/sources"])("%s", (dir) => {
    const styled = files(join(UI, dir)).filter((f) => /fontStyle:\s*"italic"/.test(readFileSync(f, "utf8")));
    expect(styled).toEqual([]);
  });
});
