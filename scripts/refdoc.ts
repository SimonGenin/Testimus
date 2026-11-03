import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { quietCtx } from "../src/core/command.ts";
import { env } from "../src/core/env.ts";
import { refdocScore, refdocText } from "../src/core/lib/models-quality.ts";
import { APP_VERSION } from "../src/core/rag/eval.ts";
import { measureVariant } from "../src/core/rag/refdoc.ts";
import type { Catalog, PackMeasure } from "../src/core/types.ts";

// ponytail: node scripts/refdoc.ts [pack…] — every pack variant whose models are on this PC, measured on the
// reference document; the figures go to models/catalog.json packs[].measured, what a card shows before a measure here

const FILE = fileURLToPath(new URL("../models/catalog.json", import.meta.url));
const only = process.argv.slice(2);
const c = JSON.parse(readFileSync(FILE, "utf8")) as Catalog;

for (const p of c.packs) {
  if (only.length && !only.includes(p.id)) continue;
  for (const v of p.variants) {
    const name = `${p.id}: ${v.embedding} + ${v.reranker ?? "no reranker"}`;
    try {
      const s = refdocScore(await measureVariant(quietCtx(null), v, p.retrieval));
      if (!s) throw new Error("the report has no question");
      const m: PackMeasure = { ...v, ...s, app: APP_VERSION, date: env.now().toISOString().slice(0, 10) };
      p.measured = [...(p.measured ?? []).filter((x) => x.embedding !== v.embedding || x.reranker !== v.reranker), m];
      writeFileSync(FILE, `${JSON.stringify(c, null, 2)}\n`);
      process.stdout.write(`${name}: ${refdocText(s, "Testimus")}\n`);
    } catch (e) {
      process.stdout.write(`${name}: skipped — ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
}
