import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-media.ts";
import type { DocJson, FigureEntry } from "../../../../src/core/types.ts";
import { sampleDocx } from "../../../fixtures/docx/sample.ts";
import { call, fixtureCopy } from "../registry.ts";

const D3 = "SOSIE_211_D401-1_3";
const LOT = "recette-tco-12-10";
const real = env.spawnClaude;
let P = "";
let runs: ClaudeSpawn[] = [];

type Job = {
  lot: { id: string; included: boolean; photos: number; analysed: number; state: string } | null;
  added: string[];
  rejected: { name: string; code: string }[];
  analysed: number;
  changed: boolean;
  citedBy: { id: string }[];
};
type Show = {
  id: string;
  context: string;
  reference: boolean;
  part: string;
  items: {
    id: string;
    name: string;
    state: string;
    figure?: string;
    takenAt?: string;
    width?: number;
    description: string;
    labels: string[];
    illustrates: string[];
  }[];
  citedBy: { id: string }[];
};

const dir = () => join(P, "docs", D3);
const read = (f: string) => readFileSync(join(dir(), f), "utf8");
const docJson = () => JSON.parse(read("doc.json")) as DocJson;
const figures = () => JSON.parse(read("figures.json")) as FigureEntry[];
const b64 = (b: Buffer) => b.toString("base64");

async function photo(w: number, h: number, when?: string, png = false): Promise<Buffer> {
  const img = sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 120, b: 160 } } });
  if (png) return img.png().toBuffer();
  return (when ? img.jpeg().withExif({ IFD0: { DateTime: when } }) : img.jpeg()).toBuffer();
}

beforeEach(() => {
  P = fixtureCopy("media");
  runs = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
  env.spawnClaude = (s) => {
    if (!s.args.includes("--version")) runs.push(s);
    return mockSpawnClaude(s);
  };
});

afterEach(() => {
  env.spawnClaude = real;
  resetProbe();
});

describe("media.add", () => {
  it("copies the photos, makes their pictures, has Claude read them and writes the annex into doc.md", async () => {
    const late = await photo(2400, 1200, "2026:10:12 15:00:00");
    const early = await photo(800, 600, "2026:10:12 09:30:00");
    const body = read("body.md");
    const r = await call<Job>(
      "media.add",
      {
        doc: D3,
        title: "Essai freinage",
        context: "Photos du pupitre réel, version 3.2.",
        files: [
          { name: "IMG_2.jpg", dataBase64: b64(late) },
          { name: "IMG_1.jpg", dataBase64: b64(early) },
          { name: "dup.jpg", dataBase64: b64(early) },
          { name: "notes.txt", dataBase64: b64(Buffer.from("x")) },
          { name: "clip.mp4", dataBase64: b64(Buffer.from("x")) },
          { name: "shot.heic", dataBase64: b64(Buffer.from("x")) },
        ],
        index: false,
      },
      P,
    );
    expect(r.lot).toMatchObject({ id: "essai-freinage", included: true, photos: 2, analysed: 2, state: "ready" });
    expect(r.added).toEqual(["img-2", "img-1"]);
    expect(r.rejected.map((x) => [x.name, x.code])).toEqual([
      ["dup.jpg", "duplicate"],
      ["notes.txt", "not-a-photo"],
      ["clip.mp4", "later"],
      ["shot.heic", "later"],
    ]);
    expect(r.changed).toBe(true);
    expect(runs).toHaveLength(1);
    expect(runs[0].stdin).toContain("Photos du pupitre réel, version 3.2.");
    expect(runs[0].stdin).toContain("- §5.6.6 Sectionneur (S)");

    const lot = docJson().media?.find((l) => l.id === "essai-freinage");
    expect(lot?.items.find((i) => i.id === "img-2")).toMatchObject({ width: 2000, height: 1000, state: "analysed" });
    expect(existsSync(join(dir(), "media", "essai-freinage", "files", "IMG_2.jpg"))).toBe(true);
    const meta = await sharp(join(dir(), "figures", "lot-essai-freinage-img-2.jpg")).metadata();
    expect([meta.format, meta.width]).toEqual(["jpeg", 2000]);

    const md = read("doc.md");
    expect(read("body.md")).toBe(body);
    expect(md.startsWith(body.trimEnd())).toBe(true);
    expect(md).toContain("# Annexe — Essai freinage <!-- § lot-essai-freinage -->");
    expect(md).toContain("Contexte du lot : Photos du pupitre réel, version 3.2.");
    // ponytail: the batch is read in the order the photos were taken (EXIF), not the order they were given
    expect(md.indexOf("§ lot-essai-freinage.img-1 ")).toBeLessThan(md.indexOf("§ lot-essai-freinage.img-2 "));
    expect(md).toContain(
      "![IMG_1.jpg — 12/10/2026 09:30](figures/lot-essai-freinage-img-1.jpg) <!-- fig lot-essai-freinage.img-1 -->",
    );
    expect(md).toContain("Texte visible : « Propriétés » · « Autoriser l'ouverture »");
    expect(md).toContain("Illustre §5.6.6.");
    expect(md).not.toContain("lot-recette-tco-12-10");
    const fig = figures().find((f) => f.anchor === "fig:lot-essai-freinage.img-1");
    expect(fig).toMatchObject({ file: "figures/lot-essai-freinage-img-1.jpg", kind: "screen" });
    expect(fig?.description).toMatch(/^Photo simulée de IMG_1\.jpg/);
  });

  it("keeps the batch beside the document with include false, and refuses an unknown document", async () => {
    const r = await call<Job>(
      "media.add",
      {
        doc: D3,
        files: [{ name: "a.png", dataBase64: b64(await photo(40, 30, undefined, true)) }],
        include: false,
        index: false,
      },
      P,
    );
    expect(r.lot).toMatchObject({ included: false, photos: 1 });
    expect(r.lot?.id).toMatch(/^photos-\d{4}-\d{2}-\d{2}$/);
    expect(r.changed).toBe(false);
    expect(read("doc.md")).toBe(read("body.md"));
    await expect(call("media.add", { doc: "NOPE", files: [{ path: "x.jpg" }] }, P)).rejects.toThrow(/No document NOPE/);
  });
});

describe("a batch in the document", () => {
  it("media.include puts the fixture's batch in doc.md and takes it out again; the toc and the corpus follow", async () => {
    const body = read("body.md");
    const on = await call<Job>("media.include", { doc: D3, lot: LOT, included: true, index: false }, P);
    expect(on).toMatchObject({ changed: true, lot: { included: true } });
    expect(on.citedBy.map((t) => t.id)).toContain("LFRPS12-1420");
    type Toc = { toc: { anchor: string; level: number }[]; figures: { anchor: string }[] };
    const shown = await call<Toc>("docs.show", { id: D3, brief: true }, P);
    expect(shown.toc.slice(-3)).toEqual([
      { anchor: `§lot-${LOT}`, title: "Annexe — Recette TCO 12/10", level: 0 },
      { anchor: `§lot-${LOT}.img-0042`, title: "IMG_0042", level: 1 },
      { anchor: `§lot-${LOT}.img-0043`, title: "IMG_0043", level: 1 },
    ]);
    expect(shown.figures.map((f) => f.anchor)).toContain(`fig:lot-${LOT}.img-0042`);
    const off = await call<Job>("media.include", { doc: D3, lot: LOT, included: false, index: false }, P);
    expect(off.changed).toBe(true);
    expect(read("doc.md")).toBe(body);
    const after = await call<Toc>("docs.show", { id: D3, brief: true }, P);
    expect(after.figures.map((f) => f.anchor)).not.toContain(`fig:lot-${LOT}.img-0042`);
  });

  it("media.context changes the context, the title and the reference mark, and writes the annex again", async () => {
    await call("media.include", { doc: D3, lot: LOT, included: true, index: false }, P);
    await call(
      "media.context",
      {
        doc: D3,
        lot: LOT,
        text: "Écrans de référence validés par le client.",
        title: "Recette validée",
        reference: true,
        index: false,
      },
      P,
    );
    const s = await call<Show>("media.show", { doc: D3, lot: LOT }, P);
    expect(s).toMatchObject({
      context: "Écrans de référence validés par le client.",
      reference: true,
      title: "Recette validée",
    });
    expect(read("doc.md")).toContain(`# Annexe — Recette validée <!-- § lot-${LOT} -->`);
    expect(read("doc.md")).toContain("Contexte du lot : Écrans de référence validés par le client.");
    await call("media.context", { doc: D3, lot: LOT, text: "", reference: false, index: false }, P);
    const t = await call<Show>("media.show", { doc: D3, lot: LOT }, P);
    expect(t).toMatchObject({ context: "", reference: false });
    expect(read("doc.md")).not.toContain("Contexte du lot");
  });

  it("media.addFiles reads only the new photos; media.removeFile takes one out with its picture", async () => {
    const r = await call<Job>(
      "media.addFiles",
      {
        doc: D3,
        lot: LOT,
        files: [{ name: "IMG_0050.jpg", dataBase64: b64(await photo(64, 48, "2026:10:12 16:00:00")) }],
        index: false,
      },
      P,
    );
    expect(r.added).toEqual(["img-0050"]);
    expect(runs).toHaveLength(1);
    expect(runs[0].stdin).toContain(`fig:lot-${LOT}.img-0050`);
    expect(runs[0].stdin).not.toContain(`fig:lot-${LOT}.img-0042`);
    const s = await call<Show>("media.show", { doc: D3, lot: LOT }, P);
    expect(s.items.map((i) => [i.id, i.state])).toEqual([
      ["img-0042", "analysed"],
      ["img-0043", "analysed"],
      ["img-0050", "analysed"],
    ]);
    expect(s.items[0]).toMatchObject({ takenAt: "2026-10-12T14:03:10", illustrates: ["§5.6.6"] });
    expect(s.items[0].labels).toContain("Autoriser l'ouverture");
    expect(s.part).toContain("## IMG_0050");

    await call("media.removeFile", { doc: D3, lot: LOT, item: "img-0042", index: false }, P);
    const t = await call<Show>("media.show", { doc: D3, lot: LOT }, P);
    expect(t.items.map((i) => i.id)).toEqual(["img-0043", "img-0050"]);
    expect(t.part).not.toContain("IMG_0042");
    expect(existsSync(join(dir(), "figures", `lot-${LOT}-img-0042.jpg`))).toBe(false);
    expect(existsSync(join(dir(), "media", LOT, "files", "IMG_0042.jpg"))).toBe(false);
    expect(figures().some((f) => f.anchor === `fig:lot-${LOT}.img-0042`)).toBe(false);
    await expect(call("media.removeFile", { doc: D3, lot: LOT, item: "img-0042" }, P)).rejects.toThrow(
      /no item img-0042/,
    );
  });

  it("media.analyse reads the photos again with force, or only the items given", async () => {
    await call("media.analyse", { doc: D3, lot: LOT, items: ["img-0043"], index: false }, P);
    expect(runs).toHaveLength(1);
    expect(runs[0].stdin).toContain(`fig:lot-${LOT}.img-0043`);
    expect(runs[0].stdin).not.toContain(`fig:lot-${LOT}.img-0042`);
    const r = await call<Job>("media.analyse", { doc: D3, lot: LOT, force: true, index: false }, P);
    expect(r.analysed).toBe(2);
    expect((await call<Show>("media.show", { doc: D3, lot: LOT }, P)).items[0].description).toMatch(/^Photo simulée/);
    await expect(call("media.analyse", { doc: D3, lot: LOT, items: ["zz"] }, P)).rejects.toThrow(/no item zz/);
  });

  it("media.remove takes the batch away; the tests citing its annex are checked again and say it is missing", async () => {
    await call("media.include", { doc: D3, lot: LOT, included: true, index: false }, P);
    const test = join(P, "tests", "LFRPS12-1420", "test.md");
    writeFileSync(
      test,
      readFileSync(test, "utf8").replace(
        "### Sources\n",
        `### Sources\n\n- ${D3}#§lot-${LOT}.img-0043 "elle indique un sectionneur sans télécommande (TK)"\n`,
      ),
    );
    expect((await call<Show>("media.show", { doc: D3, lot: LOT }, P)).citedBy.map((t) => t.id)).toEqual([
      "LFRPS12-1420",
    ]);
    const r = await call<Job>("media.remove", { doc: D3, lot: LOT, index: false }, P);
    expect(r).toMatchObject({ lot: null, changed: true });
    expect(r.citedBy.map((t) => t.id)).toContain("LFRPS12-1420");
    expect(existsSync(join(dir(), "media", LOT))).toBe(false);
    expect(readdirSync(join(dir(), "figures")).filter((f) => f.startsWith("lot-"))).toEqual([]);
    expect(figures().map((f) => f.anchor)).toEqual(["fig:40"]);
    expect(read("doc.md")).toBe(read("body.md"));
    const check = JSON.parse(readFileSync(join(P, "tests", "LFRPS12-1420", "check.json"), "utf8")) as {
      findings: { kind: string; message: string }[];
    };
    expect(check.findings.some((f) => f.kind === "source-missing" && f.message.includes(`§lot-${LOT}.img-0043`))).toBe(
      true,
    );
    await expect(call("media.show", { doc: D3, lot: LOT }, P)).rejects.toThrow(/has no batch/);
  });

  it("media.list gives every document's batches, or one document's", async () => {
    const all = await call<{ doc: string; id: string; state: string; anchor: string }[]>("media.list", {}, P);
    expect(all).toEqual([
      expect.objectContaining({ doc: D3, id: LOT, photos: 2, analysed: 2, state: "ready", anchor: `§lot-${LOT}` }),
    ]);
    expect(await call("media.list", { doc: "SOSIE_211_D401-1_4" }, P)).toEqual([]);
  });
});

describe("batches and the conversion", () => {
  it("docs.add takes batches, docs.convert media picks them; annexes and their figures outlive a reconversion", async () => {
    const file = join(P, "..", "SPEC_X_01.01.docx");
    writeFileSync(file, sampleDocx());
    const shot = b64(await photo(64, 48, "2026:10:01 10:00:00"));
    const doc = await call<DocJson>(
      "docs.add",
      {
        file,
        describeFigures: false,
        media: [
          { title: "Cabine", context: "Photos de la cabine réelle.", files: [{ name: "c1.jpg", dataBase64: shot }] },
        ],
      },
      P,
    );
    const at = join(P, "docs", doc.id);
    const md = () => readFileSync(join(at, "doc.md"), "utf8");
    expect(md()).toContain("# Annexe — Cabine <!-- § lot-cabine -->");
    // ponytail: describeFigures off also leaves the photos unread — they are in the annex with their picture
    expect(md()).toContain("![c1.jpg — 01/10/2026 10:00](figures/lot-cabine-c1.jpg)");
    expect(runs).toHaveLength(0);
    const body = readFileSync(join(at, "body.md"), "utf8");
    expect(body).not.toContain("lot-cabine");

    await call("docs.convert", { id: doc.id, media: [] }, P);
    expect(md()).toBe(readFileSync(join(at, "body.md"), "utf8"));
    await call("docs.convert", { id: doc.id, media: ["cabine"] }, P);
    expect(runs.filter((r) => r.stdin.includes("Testimus media run"))).toHaveLength(1);
    expect(md()).toContain("Photo simulée de c1.jpg");
    const figs = JSON.parse(readFileSync(join(at, "figures.json"), "utf8")) as FigureEntry[];
    expect(figs.some((f) => f.anchor === "fig:lot-cabine.c1" && f.description)).toBe(true);
    await expect(call("docs.convert", { id: doc.id, media: ["nope"] }, P)).rejects.toThrow(/has no batch nope/);
  });
});
