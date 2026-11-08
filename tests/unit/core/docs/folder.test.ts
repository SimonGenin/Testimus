import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { env } from "../../../../src/core/env.ts";
import { listJobs } from "../../../../src/core/jobs.ts";
import { idOf } from "../../../../src/core/lib/docs-folder.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";
import { taggedPdf } from "../../../fixtures/pdf/tagged.ts";
import { call, fixtureCopy } from "../registry.ts";

const FOLDER = resolve(import.meta.dirname, "../../../fixtures/folder");

type Scan = {
  dir: string;
  files: { rel: string; importable: boolean; id?: string; twin?: string; reason?: string; why?: string }[];
  documents: number;
  leftAside: number;
  truncated: boolean;
};

const real = env.spawnClaude;
afterEach(() => {
  env.spawnClaude = real;
  resetProbe();
});

// ponytail: the files git does not keep (Thumbs.db, desktop.ini, .DS_Store, a hidden folder) are added to a copy
function folderCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "testimus-folder-"));
  cpSync(FOLDER, dir, { recursive: true });
  writeFileSync(join(dir, "Thumbs.db"), "x");
  writeFileSync(join(dir, "desktop.ini"), "x");
  writeFileSync(join(dir, ".DS_Store"), "x");
  mkdirSync(join(dir, ".svn"));
  writeFileSync(join(dir, ".svn", "Caché.docx"), "x");
  return dir;
}

const byRel = (s: Scan) => Object.fromEntries(s.files.map((f) => [f.rel, f]));

describe("docs.scanFolder", () => {
  it("says, file by file, what an import adds and why the rest is left aside", async () => {
    const P = fixtureCopy("scan");
    const dir = folderCopy();
    const s = await call<Scan>("docs.scanFolder", { dir }, P);
    const f = byRel(s);
    expect(f["SOSIE_300_D401-1_1_01_00.docx"]).toMatchObject({
      importable: true,
      id: "SOSIE_300_D401-1_1",
      twin: "SOSIE_300_D401-1_1_01_00.pdf",
    });
    expect(f["SOSIE_300_D401-1_1_01_00.pdf"]).toMatchObject({ importable: false, reason: "twin" });
    expect(f["SOSIE_301_D401-1_2 Signalisation.pdf"]).toMatchObject({ importable: true });
    expect(f["Sous-dossier/Énergie.docx".normalize()] ?? f["Sous-dossier/Énergie.docx".normalize("NFD")]).toMatchObject(
      { importable: true, id: "Energie" },
    );
    expect(f["Notes de réunion.txt".normalize()] ?? f["Notes de réunion.txt".normalize("NFD")]).toMatchObject({
      importable: false,
      reason: "not-supported",
      why: "Testimus cannot convert .txt files yet",
    });
    expect(f["~$SIE_300_D401-1_1_01_00.docx"]).toMatchObject({ reason: "lock-file", why: "Word's lock file" });
    expect(f["Thumbs.db"]).toMatchObject({ reason: "not-a-document" });
    expect(f["desktop.ini"]).toMatchObject({ reason: "not-a-document" });
    expect(f[".DS_Store"]).toMatchObject({ reason: "not-a-document" });
    expect(f["Ancien.doc"]).toMatchObject({ reason: "not-supported" });
    expect(f["Vide.pdf"]).toMatchObject({ reason: "empty" });
    expect(f["SOSIE_211_D401-1_3_01_01.docx"]).toMatchObject({
      reason: "in-project",
      id: "SOSIE_211_D401-1_3",
      why: "already in the project",
    });
    expect(f["Sous-dossier/Copie/SOSIE_300_D401-1_1_01_00.docx"]).toMatchObject({
      reason: "same-code",
      why: "the same document code as SOSIE_300_D401-1_1_01_00.docx",
    });
    expect(s.files.some((x) => x.rel.startsWith(".svn/"))).toBe(false);
    expect(s.documents).toBe(3);
    expect(s.leftAside).toBe(s.files.length - 3 - 1);
    expect(s.truncated).toBe(false);
  });

  it("reads only the folder itself without recursive", async () => {
    const s = await call<Scan>("docs.scanFolder", { dir: folderCopy(), recursive: false }, fixtureCopy("scan-flat"));
    expect(s.files.some((x) => x.rel.includes("/"))).toBe(false);
    expect(s.documents).toBe(2);
  });

  it("never reads the project's own folder", async () => {
    const parent = mkdtempSync(join(tmpdir(), "testimus-parent-"));
    const P = join(parent, "project");
    cpSync(fixtureCopy("scan-inside"), P, { recursive: true });
    writeFileSync(join(parent, "SPEC_A_01_00.docx"), "x");
    const s = await call<Scan>("docs.scanFolder", { dir: parent }, P);
    expect(s.files.map((x) => x.rel)).toEqual(["SPEC_A_01_00.docx"]);
  });

  it("refuses a network path, a relative path and a folder that is not there", async () => {
    const P = fixtureCopy("scan-refuse");
    await expect(call("docs.scanFolder", { dir: "\\\\server\\share\\specs" }, P)).rejects.toThrow(/network path/);
    await expect(call("docs.scanFolder", { dir: "//server/share" }, P)).rejects.toThrow(/network path/);
    await expect(call("docs.scanFolder", { dir: "specs/J5" }, P)).rejects.toThrow(/not a full path/);
    await expect(call("docs.scanFolder", { dir: join(P, "nowhere") }, P)).rejects.toThrow(/No folder/);
  });

  it("gives every file an id a document folder can have", () => {
    expect(idOf("/x/SOSIE_211_D401-1_3_01_01.docx")).toBe("SOSIE_211_D401-1_3");
    expect(idOf("/x/Énergie.docx")).toBe("Energie");
    expect(idOf("/x/Notes de réunion v1.2.pdf")).toBe("Notes_de_reunion");
    expect(idOf("/x/__.pdf")).toBe("document");
  });
});

describe("docs.addFolder", () => {
  it("copies the documents asked for with their renderings and says what it left", async () => {
    const P = fixtureCopy("addfolder");
    const dir = mkdtempSync(join(tmpdir(), "testimus-client-"));
    writeFileSync(join(dir, "SPEC_F_01_00.docx"), sampleDocx());
    writeFileSync(join(dir, "SPEC_F_01_00.pdf"), taggedPdf());
    writeFileSync(join(dir, "SPEC_G_01_00.pdf"), taggedPdf());
    writeFileSync(join(dir, "Thumbs.db"), "x");
    const r = await call<{
      added: { id: string; twin?: { file: string }; converted?: unknown }[];
      rejected: { name: string; why: string; code: string }[];
      converted: unknown[];
    }>("docs.addFolder", { dir, convert: false, files: ["SPEC_F_01_00.docx", "Thumbs.db"] }, P);
    expect(r.added.map((d) => [d.id, d.twin?.file ?? null, d.converted ?? null])).toEqual([
      ["SPEC_F", "source.pdf", null],
    ]);
    expect(r.rejected).toEqual([{ name: "Thumbs.db", why: "not a document", code: "left-aside" }]);
    expect(r.converted).toEqual([]);
    expect(existsSync(join(P, "docs", "SPEC_G"))).toBe(false);
  });

  it("converts and indexes each document in its own job", async () => {
    const P = fixtureCopy("addfolder-convert");
    const dir = mkdtempSync(join(tmpdir(), "testimus-client-"));
    writeFileSync(join(dir, "SPEC_H_01_00.docx"), sampleDocx());
    writeFileSync(join(dir, "SPEC_I_01_00.docx"), sampleDocx());
    const r = await call<{ added: { id: string }[]; converted: { id: string; jobId: string; status: string }[] }>(
      "docs.addFolder",
      { dir, describeFigures: false },
      P,
    );
    expect(r.added.map((d) => d.id)).toEqual(["SPEC_H", "SPEC_I"]);
    expect(r.converted.map((c) => [c.id, c.status])).toEqual([
      ["SPEC_H", "done"],
      ["SPEC_I", "done"],
    ]);
    const jobs = listJobs(P);
    const parent = jobs.find((j) => j.kind === "docs.add");
    const converts = jobs.filter((j) => j.kind === "docs.convert");
    expect(converts.map((j) => j.subject).sort()).toEqual(["SPEC_H", "SPEC_I"]);
    expect(converts.every((j) => j.parentId === parent?.id && j.status === "done")).toBe(true);
    const listed = await call<{ id: string; indexed: string }[]>("docs.list", {}, P);
    expect(listed.filter((d) => d.id.startsWith("SPEC_")).map((d) => d.indexed)).toEqual(["fresh", "fresh"]);
  });
});
