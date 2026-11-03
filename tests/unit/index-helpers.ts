import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readDoc } from "../../src/core/lib/docs.ts";
import { docContent } from "../../src/core/rag/indexer.ts";

export function markIndexed(project: string, only?: string[]): void {
  const root = join(project, "docs");
  const ids = readdirSync(root).filter((id) => existsSync(join(root, id, "doc.json")) && (!only || only.includes(id)));
  const docs = Object.fromEntries(ids.map((id) => [id, docContent(join(root, id), readDoc(project, id))]));
  mkdirSync(join(project, "index"), { recursive: true });
  writeFileSync(
    join(project, "index", "state.json"),
    JSON.stringify({ embedding: "none", dims: 0, builtAt: "2026-01-01T00:00:00.000Z", docs, space: null }),
  );
}
