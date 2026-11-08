import fs, { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import { loadCorpus, mechanicalFindings } from "../../../../src/core/lib/check.ts";
import { sha256 } from "../../../../src/core/lib/hash.ts";
import { copyMediaFiles, newMediaDoc } from "../../../../src/core/lib/media.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-media.ts";
import { chunkDoc } from "../../../../src/core/rag/chunk.ts";
import type { DocJson, FigureEntry, Source, Step, Test } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

const real = env.spawnClaude;
let P = "";
let runs: ClaudeSpawn[] = [];

type Added = { added: DocJson[]; rejected: { name: string; code: string }[] };
type Media = { added: number[]; removed?: number; rejected: { name: string; code: string }[]; files: { n: number }[] };
type Show = {
  type: string;
  observed: boolean;
  images: { n: number; anchor: string; caption: string; description: string; takenAt?: string; width?: number }[];
};

const dir = (id: string) => join(P, "docs", id);
const md = (id: string) => readFileSync(join(dir(id), "doc.md"), "utf8");
const doc = (id: string) => JSON.parse(readFileSync(join(dir(id), "doc.json"), "utf8")) as DocJson;
const figures = (id: string) => JSON.parse(readFileSync(join(dir(id), "figures.json"), "utf8")) as FigureEntry[];
const b64 = (b: Buffer) => b.toString("base64");

async function photo(w: number, h: number, when?: string, g = 120): Promise<Buffer> {
  const img = sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g, b: 160 } } });
  return (when ? img.jpeg().withExif({ IFD0: { DateTime: when } }) : img.jpeg()).toBuffer();
}

beforeEach(() => {
  P = fixtureCopy("images");
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

describe("images picked together", () => {
  it("are one images document: copied, numbered in the order they come, prepared, read by Claude, written to doc.md", async () => {
    const late = await photo(2400, 1200, "2026:10:12 15:00:00", 100);
    const early = await photo(800, 600, "2026:10:12 09:30:00", 140);
    const r = await call<Added>(
      "docs.addFiles",
      {
        files: [
          { name: "IMG_2.jpg", dataBase64: b64(late) },
          { name: "IMG_1.jpg", dataBase64: b64(early) },
          { name: "dup.jpg", dataBase64: b64(early) },
          { name: "shot.heic", dataBase64: b64(Buffer.from("x")) },
        ],
        title: "Visite du PCC",
      },
      P,
    );
    expect(r.added.map((d) => [d.id, d.title, d.source.type, d.kind])).toEqual([
      ["Visite_du_PCC", "Visite du PCC", "images", "other"],
    ]);
    expect(r.rejected.map((x) => [x.name, x.code])).toEqual([
      ["shot.heic", "not-a-document"],
      ["dup.jpg", "failed"],
    ]);
    const id = "Visite_du_PCC";
    expect(doc(id).source.files?.map((f) => [f.n, f.name, f.state])).toEqual([
      [1, "IMG_2.jpg", "new"],
      [2, "IMG_1.jpg", "new"],
    ]);
    await call("docs.convert", { id, index: false }, P);
    const d = doc(id);
    expect(d.source.files?.map((f) => [f.n, f.state, f.figure, f.takenAt, f.width])).toEqual([
      [1, "analysed", "figures/img-1.jpg", "2026-10-12T15:00:00", 2000],
      [2, "analysed", "figures/img-2.jpg", "2026-10-12T09:30:00", 800],
    ]);
    expect(d.converted?.with).toBe("media 1");
    expect(runs).toHaveLength(1);
    expect(runs[0].stdin).toContain(
      "- img:2 — docs/Visite_du_PCC/figures/img-2.jpg — IMG_1.jpg — taken 2026-10-12 09:30",
    );
    expect(md(id)).toBe(
      [
        "# Visite du PCC <!-- § media -->",
        "",
        "![IMG_1.jpg — 2026-10-12 09:30](figures/img-2.jpg) <!-- img 2 -->",
        "",
        "![IMG_2.jpg — 2026-10-12 15:00](figures/img-1.jpg) <!-- img 1 -->",
        "",
      ].join("\n"),
    );
    expect(figures(id).map((f) => [f.anchor, f.caption, !!f.description, f.labels?.length])).toEqual([
      ["img:2", "IMG_1.jpg — 2026-10-12 09:30", true, 2],
      ["img:1", "IMG_2.jpg — 2026-10-12 15:00", true, 2],
    ]);
    const show = await call<Show>("media.show", { doc: id }, P);
    expect(show).toMatchObject({ type: "images", observed: true });
    expect(show.images.map((i) => i.anchor)).toEqual(["img:2", "img:1"]);
  });

  it("are one document each when asked", async () => {
    const r = await call<Added>(
      "docs.addFiles",
      {
        files: [
          {
            name: "Synoptique.png",
            dataBase64: b64(
              await sharp({ create: { width: 10, height: 10, channels: 4, background: "#00000000" } })
                .png()
                .toBuffer(),
            ),
          },
          { name: "Menu.jpg", dataBase64: b64(await photo(20, 20)) },
        ],
        images: "each",
      },
      P,
    );
    expect(r.added.map((d) => [d.id, d.title, d.source.files?.length])).toEqual([
      ["Synoptique", "Synoptique", 1],
      ["Menu", "Menu", 1],
    ]);
  });
});

describe("adding and removing images", () => {
  it("never moves an anchor: a new image takes the next number, a removed number is never given again", async () => {
    const id = "RECETTE_TCO_12-10";
    const before = md(id);
    const add = await call<Media>(
      "media.add",
      {
        doc: id,
        files: [{ name: "IMG_0050.jpg", dataBase64: b64(await photo(640, 480, "2026:10:12 14:04:00")) }],
        index: false,
      },
      P,
    );
    expect(add.added).toEqual([3]);
    const after = md(id);
    for (const line of before.split("\n").filter((l) => l.includes("<!-- img"))) expect(after).toContain(line);
    expect(after).toContain("](figures/img-3.jpg) <!-- img 3 -->");
    expect(after.indexOf("<!-- img 3 -->")).toBeLessThan(after.indexOf("<!-- img 2 -->"));
    const removed = await call<Media>("media.remove", { doc: id, n: 3, index: false }, P);
    expect(removed.removed).toBe(3);
    expect(existsSync(join(dir(id), "figures", "img-3.jpg"))).toBe(false);
    expect(md(id)).toBe(before);
    const again = await call<Media>(
      "media.add",
      {
        doc: id,
        files: [{ name: "IMG_0051.jpg", dataBase64: b64(await photo(640, 480, undefined, 30)) }],
        index: false,
      },
      P,
    );
    expect(again.added).toEqual([4]);
    expect(doc(id).source.last).toBe(4);
  });

  it("refuses to remove the last file, and a document that is not an images document", async () => {
    await expect(call("media.remove", { doc: "SOSIE_211_D401-1_3", n: 1 }, P)).rejects.toThrow(
      "not an images or video document",
    );
    await call("media.remove", { doc: "RECETTE_TCO_12-10", n: 1, index: false }, P);
    await expect(call("media.remove", { doc: "RECETTE_TCO_12-10", n: 2, index: false }, P)).rejects.toThrow(
      "is the last file",
    );
  });
});

const step = (sources: Source[], expected = "La fenêtre Propriétés s'ouvre."): Step => ({
  fields: { Action: "Ouvrir les propriétés du sectionneur S12.", "Expected Result": expected },
  sources,
  images: [],
});
const testOf = (steps: Step[]) => ({ summary: "s", steps }) as unknown as Test;
const IMAGE: Source = { docId: "RECETTE_TCO_12-10", anchor: "img:2", quote: "IMG_0043.jpg — 2026-10-12 14:05" };
const SPEC: Source = {
  docId: "SOSIE_211_D401-1_3",
  anchor: "§5.6.6",
  quote: "Le sectionneur est représenté sur la schématique de traction",
};

describe("files copied into a document", () => {
  it("never write over a file already there: a name taken gets the next free one", () => {
    newMediaDoc(P, { id: "D", title: "D", name: "a.jpg" });
    const pick = (name: string, text: string) => ({ name, dataBase64: Buffer.from(text).toString("base64") });
    copyMediaFiles(P, "D", [pick("a.jpg", "one"), pick("3-a.jpg", "two")]);
    const r = copyMediaFiles(P, "D", [pick("a.jpg", "three")]);
    expect(r.added.map((f) => [f.n, f.file])).toEqual([[3, "files/3-2-a.jpg"]]);
    expect(readFileSync(join(dir("D"), "files", "3-a.jpg"), "utf8")).toBe("two");
    expect(readFileSync(join(dir("D"), "files", "3-2-a.jpg"), "utf8")).toBe("three");
  });

  it("take a video past 2 GiB from this PC: hashed and copied as it streams, never read whole", () => {
    const big = join(mkdtempSync(join(tmpdir(), "testimus-big-")), "long.mp4");
    writeFileSync(big, "a video");
    const whole = fs.readFileSync;
    (fs as { readFileSync: unknown }).readFileSync = (...a: Parameters<typeof whole>) => {
      if (String(a[0]) === big) throw new RangeError(`File size (2147487744) is greater than 2 GiB`);
      return whole(...a);
    };
    syncBuiltinESMExports();
    try {
      newMediaDoc(P, { id: "V", title: "V", name: "long.mp4" });
      const r = copyMediaFiles(P, "V", [{ path: big }]);
      expect(r.rejected).toEqual([]);
      expect(r.added[0]).toMatchObject({ n: 1, file: "files/long.mp4", kind: "video", sha256: sha256("a video") });
      expect(whole(join(dir("V"), "files", "long.mp4"), "utf8")).toBe("a video");
      expect(existsSync(join(dir("V"), "files", "long.mp4.partial"))).toBe(false);
    } finally {
      (fs as { readFileSync: unknown }).readFileSync = whole;
      syncBuiltinESMExports();
    }
  });
});

describe("the mechanical check at an image", () => {
  it("finds the caption at its anchor, never what Claude read in the picture", () => {
    const corpus = loadCorpus(P);
    const ok = mechanicalFindings(testOf([step([IMAGE, SPEC])]), corpus);
    expect(ok.filter((f) => f.kind.startsWith("quote") || f.kind === "source-missing")).toEqual([]);
    const read = mechanicalFindings(
      testOf([step([{ ...IMAGE, quote: "elle indique un sectionneur sans télécommande (TK)" }, SPEC])]),
      corpus,
    );
    expect(read.map((f) => f.kind)).toContain("quote-not-found");
    const elsewhere = mechanicalFindings(testOf([step([{ ...IMAGE, anchor: "img:1" }, SPEC])]), corpus);
    expect(elsewhere.find((f) => f.kind === "quote-not-at-anchor")?.message).toContain("it is under img:2");
    const gone = mechanicalFindings(testOf([step([{ ...IMAGE, anchor: "img:9" }])]), corpus);
    expect(gone.find((f) => f.kind === "source-missing")?.message).toContain("has no anchor img:9");
  });

  it("tells an expected result backed only by an observed document, until the team marks it as the reference", async () => {
    const only = (fs: { kind: string }[]) => fs.filter((f) => f.kind === "observed-only");
    expect(only(mechanicalFindings(testOf([step([IMAGE])]), loadCorpus(P)))).toHaveLength(1);
    expect(only(mechanicalFindings(testOf([step([IMAGE, SPEC])]), loadCorpus(P)))).toEqual([]);
    expect(only(mechanicalFindings(testOf([step([IMAGE], "")]), loadCorpus(P)))).toEqual([]);
    const msg = only(mechanicalFindings(testOf([step([IMAGE])]), loadCorpus(P)))[0] as unknown as { message: string };
    expect(msg.message).toContain("pictures or videos of the real system");
    await call("docs.set", { id: "RECETTE_TCO_12-10", reference: true }, P);
    expect(doc("RECETTE_TCO_12-10").reference).toBe(true);
    expect(only(mechanicalFindings(testOf([step([IMAGE])]), loadCorpus(P)))).toEqual([]);
    await expect(call("docs.set", { id: "SOSIE_211_D401-1_3", reference: true }, P)).rejects.toThrow(
      "is a written document",
    );
  });
});

describe("the index", () => {
  it("makes one image chunk per picture — caption, Claude's reading, the visible text — and no text chunk of image lines", () => {
    const id = "RECETTE_TCO_12-10";
    const chunks = chunkDoc({ ...doc(id), id }, md(id), figures(id));
    expect(chunks.map((c) => [c.id, c.kind])).toEqual([
      [`${id}#img:1`, "image"],
      [`${id}#img:2`, "image"],
    ]);
    expect(chunks[1].text).toContain("IMG_0043.jpg — 2026-10-12 14:05");
    expect(chunks[1].text).toContain("Visible text: Propriétés — Sectionneur S12");
  });

  it("reads an image's passage like a figure's", async () => {
    const p = await call<{ title: string; text: string; figures: { file: string }[] }>(
      "rag.passage",
      { ref: "RECETTE_TCO_12-10#img:1" },
      P,
    );
    expect(p.title).toBe("IMG_0042.jpg — 2026-10-12 14:03");
    expect(p.figures[0].file).toBe("figures/img-1.jpg");
  });
});

describe("a picture in a step", () => {
  it("is embedded from an images document like a figure, and refused when the document has no such picture", async () => {
    const r = await call<{ file: string; from: string }>(
      "tests.addImage",
      { id: "local-3f9a12c0", step: 1, figure: "RECETTE_TCO_12-10#img:2" },
      P,
    );
    expect(r.from).toBe("RECETTE_TCO_12-10#img:2");
    expect(readFileSync(join(P, "tests", "local-3f9a12c0", "test.md"), "utf8")).toContain("RECETTE_TCO_12-10#img:2");
    await expect(
      call("tests.addImage", { id: "local-3f9a12c0", step: 1, figure: "RECETTE_TCO_12-10#img:9" }, P),
    ).rejects.toThrow("has no picture img:9");
  });
});
