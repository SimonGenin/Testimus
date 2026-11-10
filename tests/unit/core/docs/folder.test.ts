import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { env } from "../../../../src/core/env.ts";
import { listJobs } from "../../../../src/core/jobs.ts";
import { FOLDER_MAX_FILES, idOf } from "../../../../src/core/lib/docs-folder.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";
import { taggedPdf } from "../../../fixtures/pdf/tagged.ts";
import { call, fixtureCopy } from "../registry.ts";

const FOLDER = resolve(import.meta.dirname, "../../../fixtures/folder");

type Scan = {
  dir: string;
  files: {
    rel: string;
    importable: boolean;
    id?: string;
    twin?: string;
    group?: string;
    reason?: string;
    why?: string;
  }[];
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
    mkdirSync(join(dir, "Photos PCC"));
    writeFileSync(join(dir, "Photos PCC", "IMG_1.jpg"), "jpeg");
    writeFileSync(join(dir, "Photos PCC", "IMG_2.JPG"), "jpeg");
    writeFileSync(join(dir, "Essai PCC.mp4"), "mp4");
    writeFileSync(join(dir, "Message.mp3"), "mp3");
    writeFileSync(join(dir, "Courriel.msg"), "msg");
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
      reason: "in-project",
      id: "Notes_de_reunion",
    });
    expect([f["Photos PCC/IMG_1.jpg"], f["Photos PCC/IMG_2.JPG"]]).toMatchObject([
      { importable: true, id: "Photos_PCC", group: "Photos PCC" },
      { importable: true, id: "Photos_PCC", group: "Photos PCC" },
    ]);
    expect(f["Essai PCC.mp4"]).toMatchObject({ importable: true, id: "Essai_PCC" });
    expect(f["Message.mp3"]).toMatchObject({ importable: true, id: "Message" });
    expect(f["Courriel.msg"]).toMatchObject({ reason: "not-supported", why: "Testimus cannot convert .msg files yet" });
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
    expect(s.documents).toBe(6);
    expect(s.leftAside).toBe(s.files.length - 7 - 1 - 2);
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

  it("refuses the project's own folder and any folder inside it, whatever the case on Windows and macOS", async () => {
    const P = fixtureCopy("scan-self");
    await expect(call("docs.scanFolder", { dir: P }, P)).rejects.toThrow(/the project's own folder/);
    await expect(call("docs.scanFolder", { dir: join(P, "docs") }, P)).rejects.toThrow(/inside the project's folder/);
    await expect(call("docs.addFolder", { dir: join(P, "docs"), convert: false }, P)).rejects.toThrow(
      /inside the project's folder/,
    );
    if (process.platform === "darwin" || process.platform === "win32")
      await expect(call("docs.scanFolder", { dir: join(P, "DOCS") }, P)).rejects.toThrow(/inside the project's folder/);
  });

  it.skipIf(process.platform === "win32")("leaves out a file it cannot read the size of, and goes on", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-gone-"));
    writeFileSync(join(dir, "SPEC_A_01_00.docx"), "x");
    mkdirSync(join(dir, "locked"));
    writeFileSync(join(dir, "locked", "SPEC_B_01_00.docx"), "x");
    chmodSync(join(dir, "locked"), 0o600);
    try {
      const s = await call<Scan>("docs.scanFolder", { dir, recursive: true }, fixtureCopy("scan-gone"));
      expect(s.files.map((x) => x.rel)).toEqual(["SPEC_A_01_00.docx"]);
    } finally {
      chmodSync(join(dir, "locked"), 0o700);
    }
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
      truncated: boolean;
    }>("docs.addFolder", { dir, convert: false, files: ["SPEC_F_01_00.docx", "Thumbs.db"] }, P);
    expect(r.added.map((d) => [d.id, d.twin?.file ?? null, d.converted ?? null])).toEqual([
      ["SPEC_F", "source.pdf", null],
    ]);
    expect(r.rejected).toEqual([{ name: "Thumbs.db", why: "not a document", code: "left-aside" }]);
    expect(r.converted).toEqual([]);
    expect(r.truncated).toBe(false);
    expect(existsSync(join(P, "docs", "SPEC_G"))).toBe(false);
  });

  it("makes the images of each folder one images document, each video and text file one document", async () => {
    const P = fixtureCopy("addfolder-media");
    const dir = mkdtempSync(join(tmpdir(), "testimus-Recette 12-10-"));
    mkdirSync(join(dir, "Visite PCC"));
    const sharp = (await import("sharp")).default;
    const jpg = (g: number) =>
      sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 10, g, b: 10 } } })
        .jpeg()
        .toBuffer();
    writeFileSync(join(dir, "Visite PCC", "IMG_1.jpg"), await jpg(10));
    writeFileSync(join(dir, "Visite PCC", "IMG_2.jpg"), await jpg(200));
    writeFileSync(join(dir, "Synoptique.png"), await jpg(90));
    writeFileSync(join(dir, "Essai.mp4"), JSON.stringify({ duration: 12 }));
    writeFileSync(join(dir, "Compte rendu.txt"), "Le régulateur acquitte l'alarme.");
    const r = await call<{ added: { id: string; title: string; source: { type?: string; files?: unknown[] } }[] }>(
      "docs.addFolder",
      { dir, convert: false },
      P,
    );
    expect(r.added.map((d) => [d.id, d.title, d.source.type ?? "file", d.source.files?.length ?? 0])).toEqual([
      ["Compte_rendu", "Compte rendu", "file", 0],
      ["Essai", "Essai", "video", 1],
      [
        expect.stringMatching(/^testimus-Recette_12-10-/),
        expect.stringMatching(/^testimus-Recette 12-10-/),
        "images",
        1,
      ],
      ["Visite_PCC", "Visite PCC", "images", 2],
    ]);
  });

  it("says when the folder held more files than it reads", async () => {
    const dir = mkdtempSync(join(tmpdir(), "testimus-many-"));
    for (let i = 0; i <= FOLDER_MAX_FILES; i++) writeFileSync(join(dir, `note-${i}.xyz`), "x");
    const r = await call<{ added: unknown[]; truncated: boolean }>(
      "docs.addFolder",
      { dir, convert: false },
      fixtureCopy("addfolder-many"),
    );
    expect(r).toMatchObject({ added: [], truncated: true });
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
