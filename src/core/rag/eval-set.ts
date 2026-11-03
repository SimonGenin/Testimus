import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { UserError } from "../command.ts";
import { sha256 } from "../lib/hash.ts";
import type { Behavior } from "../types.ts";

type BehaviorSet = {
  file: string;
  hash: string;
  behaviors: Behavior[];
};

const evidenceSchema = z.object({
  ref: z.string().regex(/^[^#\s]+#\S/, "docId#anchor"),
  role: z.enum(["definition", "rule", "condition", "exception", "amendment", "contradiction", "figure"]),
  must: z.boolean().default(true),
});
const behaviorSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  queries: z.array(z.string().min(1)).default([]),
  evidence: z.array(evidenceSchema).min(1),
  category: z.string().optional(),
  validated: z.boolean().optional(),
});
export function readBehaviors(file: string): BehaviorSet {
  if (!existsSync(file))
    throw new UserError(
      `No behavior set at ${file}.`,
      "A pack is measured on Testimus's reference document (testimus models measure <pack>); this project's own set goes in eval/behaviors.jsonl.",
    );
  const raw = readFileSync(file, "utf8").replace(/^﻿/, "");
  const behaviors: Behavior[] = [];
  for (const [i, l] of raw.split(/\r?\n/).entries()) {
    if (!l.trim()) continue;
    const where = `${file} line ${i + 1}`;
    let o: unknown;
    try {
      o = JSON.parse(l);
    } catch {
      throw new UserError(`${where} is not JSON.`, "One JSON object per line.");
    }
    const issues = (e: z.ZodError) => e.issues.map((x) => `${x.path.join(".") || "line"}: ${x.message}`).join("; ");
    if (!o || typeof o !== "object" || !("evidence" in o))
      throw new UserError(`${where} needs a question and evidence.`, "See the rag-eval skill.");
    const r = behaviorSchema.safeParse(o);
    if (!r.success) throw new UserError(`${where}: ${issues(r.error)}.`, "See the rag-eval skill for the format.");
    if (!r.data.evidence.some((e) => e.must))
      throw new UserError(`${where}: no evidence has must: true.`, "Mark the evidence a test cannot do without.");
    behaviors.push(r.data);
  }
  const seen = new Set<string>();
  for (const b of behaviors) {
    if (seen.has(b.id))
      throw new UserError(`${file}: behavior id ${b.id} appears twice.`, "Give each line its own id.");
    seen.add(b.id);
  }
  if (!behaviors.length) throw new UserError(`${file} holds no behavior.`, "See the rag-eval skill.");
  return { file, hash: sha256(raw.replace(/\r\n/g, "\n")).slice(0, 16), behaviors };
}

export function defaultSet(project: string): string {
  return join(project, "eval", "behaviors.jsonl");
}
