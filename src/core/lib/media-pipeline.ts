import { type AnalyseResult, analyseLot } from "../claude/media.ts";
import type { JobRun } from "../claude/prompt.ts";
import { claudeVersion } from "../claude/status.ts";
import type { Ctx } from "../command.ts";
import { normalizeAnchor } from "../rag/anchors.ts";
import type { CitingTest } from "../types.ts";
import { testsCiting } from "./check.ts";
import { readDoc } from "./docs.ts";
import { whileConverting } from "./docs-index.ts";
import { type IndexOutcome, recheckCiting, withIndex } from "./docs-pipeline.ts";
import { assemble, findLot, lotOfAnchor, preparePhoto, syncLotFigures, updateItem, writePart } from "./media.ts";
import { readProject } from "./project.ts";

export type LotRun = JobRun & { index?: boolean };
export type LotAftermath = { citedBy: CitingTest[]; index?: IndexOutcome };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ponytail: the steps a batch job shows; those that do not apply are skipped as it goes
export function lotSteps(o: { copy?: boolean; read?: boolean; index?: boolean }) {
  return [
    ...(o.copy ? [{ id: "copy", label: "Copy the files" }] : []),
    ...(o.read ? [{ id: "prepare", label: "Prepare the photos" }] : []),
    ...(o.read ? [{ id: "read", label: "Claude reads the photos" }] : []),
    { id: "annex", label: "Write the annex" },
    { id: "cited", label: "Re-check the tests citing it" },
    ...(o.index ? [{ id: "index", label: "Update the search index" }] : []),
  ];
}

// ponytail: each photo not prepared yet becomes its picture under figures/; one that cannot be read is marked failed
// with the reason, and the others go on
export async function prepareLot(ctx: Ctx, project: string, docId: string, lot: string, force = false): Promise<void> {
  const todo = findLot(readDoc(project, docId), lot).items.filter((i) => force || i.state === "new");
  for (const [n, it] of todo.entries()) {
    if (ctx.signal.aborted) break;
    ctx.progress({ message: `Preparing ${it.name}`, done: n, total: todo.length });
    try {
      const got = await preparePhoto(project, docId, lot, it);
      updateItem(project, docId, lot, it.id, (i) => {
        Object.assign(i, got, { state: i.state === "analysed" && !force ? "analysed" : "ready" });
        delete i.error;
      });
    } catch (e) {
      ctx.log("warn", `${it.name} could not be read as a picture: ${message(e)}`);
      updateItem(project, docId, lot, it.id, (i) => {
        i.state = "failed";
        i.error = `Not a picture Testimus can read: ${message(e)}`;
      });
    }
  }
  syncLotFigures(project, docId, lot);
}

// ponytail: without Claude on this PC the photos stay in the annex with their pictures, unread — media.analyse reads
// them later; a run that fails never undoes the batch
export async function readLot(
  ctx: Ctx,
  project: string,
  docId: string,
  lot: string,
  run: JobRun,
  o: { items?: string[]; force?: boolean } = {},
): Promise<AnalyseResult | null> {
  const probe = await claudeVersion();
  if (!probe.ok) {
    ctx.log("info", `Claude is not available here (${probe.text}): the photos are kept, not read yet.`);
    return null;
  }
  try {
    return await analyseLot(project, docId, lot, ctx, { ...run, ...o });
  } catch (e) {
    if (ctx.signal.aborted) throw e;
    ctx.log("warn", `Claude did not read the photos: ${message(e)}`);
    return null;
  }
}

// ponytail: the annex is written again from what the batch holds, then doc.md is assembled — as a conversion, so an
// index run waits for it; true when doc.md changed
export function writeAnnex(project: string, docId: string, lot?: string): Promise<boolean> {
  return whileConverting(project, async () => {
    if (lot) writePart(project, docId, lot, readProject(project).language);
    return assemble(project, docId);
  });
}

// ponytail: what a changed doc.md asks for, as after a conversion: the tests citing the document are checked again,
// then the index follows in the same job
export async function afterAnnex(
  ctx: Ctx,
  project: string,
  docId: string,
  changed: boolean,
  run: LotRun,
): Promise<LotAftermath> {
  ctx.step?.("cited");
  const citedBy = changed ? recheckCiting(ctx, project, readDoc(project, docId)) : [];
  return { citedBy, ...(run.index !== false ? { index: await withIndex(ctx, project, run) } : {}) };
}

export const testsCitingLot = (project: string, docId: string, lot: string) =>
  testsCiting(project, readDoc(project, docId), (anchor) => lotOfAnchor(normalizeAnchor(anchor)) === lot);
