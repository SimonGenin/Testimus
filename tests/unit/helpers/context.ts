import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ponytail: contexts/<id>/context.md written by hand, as a team would — frontmatter (name, paths) then the notes
export function writeContextMd(dir: string, c: { name?: string; paths?: string[]; notes?: string }): void {
  mkdirSync(dir, { recursive: true });
  const head = [
    "---",
    ...(c.name !== undefined ? [`name: ${c.name}`] : []),
    ...(c.paths ? ["paths:", ...c.paths.map((p) => `  - ${p}`)] : []),
    "---",
    "",
  ];
  writeFileSync(join(dir, "context.md"), `${head.join("\n")}${c.notes ?? ""}`);
}
