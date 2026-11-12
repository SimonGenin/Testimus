import { cpSync } from "node:fs";
import { join } from "node:path";
import { env } from "../env.ts";
import { startJob } from "../jobs.ts";
import { findDoc, writeDoc } from "../lib/docs.ts";
import { copyAt } from "../lib/docs-pending.ts";
import type { DocJson, DocPending } from "../types.ts";

const held = (signal: AbortSignal) => new Promise((r) => signal.addEventListener("abort", r, { once: true }));

function hold(project: string, id: string, steps: string[], message?: string): void {
  void startJob(
    "docs.convert",
    id,
    project,
    async (k) => {
      k.steps?.(steps.map((s) => ({ id: s, label: s })));
      for (const s of steps) k.step?.(s);
      if (message) k.progress({ message, done: 2, total: 5 });
      await held(k.signal);
      return {};
    },
    undefined,
    { label: id },
  ).done.catch(() => {});
}

const at = () => env.now().toISOString();
const MB = 1024 * 1024;

function added(project: string, id: string, title: string, o: Partial<DocJson> & { pending?: DocPending }): void {
  writeDoc(project, {
    id,
    code: id,
    title,
    version: "",
    date: "",
    kind: o.source?.type ? "other" : "spec",
    status: "draft",
    source: { name: join("D:\\Specs\\J5", title), file: "", sha256: "" },
    ...o,
  });
}

// ponytail: TESTIMUS_MOCK_STAGES=1 — the fixture with a document at each stage, held there: waiting to start (one
// whose copy failed), being copied, not converted, its conversion failed, converting (the text's figures, the pictures,
// a video heard), waiting for the index, not up to date, ready (SOSIE_211_D401-1_3). The documents list as WORKLOAD.md lot 6 A asks to see it
export function mockStages(project: string | null, on: boolean): void {
  if (!project || !on) return;
  const file = (name: string, size: number) => ({ path: join("D:\\Specs\\J5", name), size });
  added(project, "SPEC_ATTENTE", "SPEC_ATTENTE_01_00.docx", {
    pending: {
      files: [file("SPEC_ATTENTE_01_00.docx", 2.4 * MB)],
      pdf: file("SPEC_ATTENTE_01_00.pdf", 3.1 * MB),
      at: at(),
    },
  });
  added(project, "Visite_PCC", "Visite PCC", {
    source: { type: "images", name: "D:\\Specs\\J5\\Visite PCC\\IMG_1.jpg", file: "", sha256: "" },
    pending: {
      files: Array.from({ length: 12 }, (_, i) => file(`Visite PCC\\IMG_${i + 1}.jpg`, 3.5 * MB)),
      at: at(),
    },
  });
  added(project, "Essai_moteur", "Essai moteur", {
    source: { type: "video", name: "D:\\Specs\\J5\\Essai moteur.mp4", file: "", sha256: "" },
    pending: {
      files: [{ ...file("Essai moteur.mp4", 820 * MB), duration: 1520, audio: true, tracks: 1 }],
      at: at(),
      failed: "D:\\Specs\\J5\\Essai moteur.mp4 is no longer there.",
    },
  });
  added(project, "SPEC_COPIE", "SPEC_COPIE_01_00.pdf", {
    pending: { files: [file("SPEC_COPIE_01_00.pdf", 48 * MB)], at: at() },
  });
  copyAt(project, "SPEC_COPIE", Math.round(19 * MB), 48 * MB);
  added(project, "SPEC_BRUT", "SPEC_BRUT_01_00.docx", {
    source: { name: "D:\\Specs\\J5\\SPEC_BRUT_01_00.docx", file: "source.docx", sha256: "" },
  });
  added(project, "SPEC_ABIME", "SPEC_ABIME_01_00.docx", {
    source: { name: "D:\\Specs\\J5\\SPEC_ABIME_01_00.docx", file: "source.docx", sha256: "" },
  });
  void startJob(
    "docs.convert",
    "SPEC_ABIME",
    project,
    async () => {
      throw new Error("The .docx cannot be opened: it is damaged (end of central directory not found).");
    },
    undefined,
    { label: "SPEC_ABIME" },
  ).done.catch(() => {});
  hold(project, "SOSIE_211_D401-1_4", ["convert", "figures"], "Claude describes the figures");
  hold(project, "RECETTE_TCO_12-10", ["convert", "read"]);
  hold(project, "Manoeuvre_d_un_sectionneur_au_PCC", ["convert"], "Transcribing manoeuvre.mp4 · 2 of 5");
  const notes = join(project, "docs", "Notes_de_reunion");
  cpSync(notes, join(project, "docs", "Notes_de_reunion_2"), { recursive: true });
  hold(project, "Notes_de_reunion_2", ["convert", "figures", "cited", "index"]);
  const stale = findDoc(project, "Notes_de_reunion");
  if (stale) writeDoc(project, { ...stale, title: `${stale.title} (revue)` });
}
