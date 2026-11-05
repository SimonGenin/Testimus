import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeFigures } from "../../../../src/core/claude/figures.ts";
import { parseMedia } from "../../../../src/core/claude/media.ts";
import { resetProbe } from "../../../../src/core/claude/status.ts";
import { quietCtx } from "../../../../src/core/command.ts";
import { env } from "../../../../src/core/env.ts";
import { assembleDir, bodyOf, exifDate, ordered, partMd } from "../../../../src/core/lib/media.ts";
import { DEFAULT_SETTINGS, writeSettings } from "../../../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-media.ts";
import type { MediaItem, MediaLot } from "../../../../src/core/types.ts";
import { call, fixtureCopy } from "../registry.ts";

const D3 = "SOSIE_211_D401-1_3";
const LOT = "recette-tco-12-10";
const real = env.spawnClaude;
let P = "";

type Job = {
  lot: { state: string; analysed: number; failed: number } | null;
  analysed: number;
  index?: { chunks?: number };
};

beforeEach(() => {
  P = fixtureCopy("media-edges");
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
});

afterEach(() => {
  env.spawnClaude = real;
  delete process.env.TESTIMUS_MOCK_CLAUDE;
  env.mock = false;
  resetProbe();
});

const jpeg = () =>
  sharp({ create: { width: 32, height: 24, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .jpeg()
    .toBuffer();

describe("a batch without Claude, and photos that cannot be read", () => {
  it("keeps the photos unread without Claude, marks a broken one failed, and media.analyse reads them later", async () => {
    process.env.TESTIMUS_MOCK_CLAUDE = "absent";
    env.spawnClaude = mockSpawnClaude;
    const r = await call<Job>(
      "media.add",
      {
        doc: D3,
        title: "Sans Claude",
        files: [
          { name: "ok.jpg", dataBase64: (await jpeg()).toString("base64") },
          { name: "broken.jpg", dataBase64: Buffer.from("not a jpeg").toString("base64") },
        ],
        index: false,
      },
      P,
    );
    expect(r).toMatchObject({ analysed: 0, lot: { state: "failed", analysed: 0, failed: 1 } });
    const shown = await call<{ items: { id: string; state: string; error?: string }[] }>(
      "media.show",
      { doc: D3, lot: "sans-claude" },
      P,
    );
    expect(shown.items.map((i) => [i.id, i.state])).toEqual([
      ["ok", "ready"],
      ["broken", "failed"],
    ]);
    expect(shown.items[1].error).toMatch(/^Not a picture Testimus can read/);
    expect(readFileSync(join(P, "docs", D3, "doc.md"), "utf8")).toContain("![ok.jpg](figures/lot-sans-claude-ok.jpg)");

    delete process.env.TESTIMUS_MOCK_CLAUDE;
    resetProbe();
    const again = await call<Job>("media.analyse", { doc: D3, lot: "sans-claude", index: false }, P);
    expect(again.analysed).toBe(1);
    expect(again.lot).toMatchObject({ analysed: 1, failed: 1 });
  });

  // ponytail: the mock embedder (env.mock), as the rag tests use it — never a model of this PC
  it("updates the index in the same job by default", async () => {
    env.spawnClaude = mockSpawnClaude;
    env.mock = true;
    const r = await call<Job>("media.include", { doc: D3, lot: LOT, included: true }, P, { wait: true });
    expect(r.index?.chunks).toBeGreaterThan(0);
    const found = await call<{ anchor: string }[]>(
      "rag.search",
      { query: "Propriétés Sectionneur S12 sans télécommande", mode: "bm25" },
      P,
    );
    expect(found.some((h) => h.anchor.startsWith(`§lot-${LOT}`) || h.anchor.startsWith(`fig:lot-${LOT}`))).toBe(true);
  });

  it("describeFigures leaves the photos of a batch to the batch's own reading", async () => {
    await call("media.include", { doc: D3, lot: LOT, included: true, index: false }, P);
    const seen: string[] = [];
    env.spawnClaude = (s) => {
      seen.push(s.stdin);
      return mockSpawnClaude(s);
    };
    await describeFigures(P, D3, quietCtx(P), { force: true });
    expect(seen.join("\n")).toContain("fig:40");
    expect(seen.join("\n")).not.toContain("fig:lot-");
  });
});

describe("the pieces of a batch", () => {
  it("reads the earliest EXIF date, and orders the photos by it, undated last", () => {
    const exif = Buffer.from("....2026:10:12 14:05:42\0....2026:10:12 14:03:10\0..0000:00:00 00:00:00", "latin1");
    expect(exifDate(exif)).toBe("2026-10-12T14:03:10");
    expect(exifDate(undefined)).toBeUndefined();
    const it = (id: string, takenAt?: string) => ({ id, takenAt }) as MediaItem;
    expect(ordered([it("a"), it("b", "2026-01-02"), it("c", "2026-01-01"), it("d")]).map((x) => x.id)).toEqual([
      "c",
      "b",
      "a",
      "d",
    ]);
  });

  it("writes the annex in English for a project in English, a photo not read yet with its picture alone", () => {
    const lot: MediaLot = {
      id: "cab",
      title: "Cab",
      included: true,
      added: "",
      items: [
        {
          id: "p1",
          name: "p1.png",
          file: "files/p1.png",
          kind: "photo",
          sha256: "",
          state: "ready",
          figure: "figures/lot-cab-p1.jpg",
          takenAt: "2026-10-01T10:00:00",
        },
      ],
    };
    expect(partMd(lot, "", [], "en")).toBe(
      [
        "# Annex — Cab <!-- § lot-cab -->",
        "",
        "1 photo. Photos of the real system: they show how it behaves and how to do things, not what it is required to do.",
        "",
        "## p1 <!-- § lot-cab.p1 -->",
        "",
        "![p1.png — 2026-10-01 10:00](figures/lot-cab-p1.jpg) <!-- fig lot-cab.p1 -->",
        "",
      ].join("\n"),
    );
  });

  it("cuts the annexes off a doc.md written before body.md existed, and assembles only the included batches", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "testimus-assemble-")), "D");
    mkdirSync(join(dir, "media", "a"), { recursive: true });
    mkdirSync(join(dir, "media", "b"), { recursive: true });
    writeFileSync(
      join(dir, "doc.md"),
      "# T\n\n## 1 Un <!-- § 1 -->\n\nTexte.\n\n# Annexe — A <!-- § lot-a -->\n\nVieux.\n",
    );
    expect(bodyOf(dir)).toBe("# T\n\n## 1 Un <!-- § 1 -->\n\nTexte.\n");
    writeFileSync(join(dir, "media", "a", "part.md"), "# Annexe — A <!-- § lot-a -->\n\nNeuf.\n");
    writeFileSync(join(dir, "media", "b", "part.md"), "# Annexe — B <!-- § lot-b -->\n");
    writeFileSync(
      join(dir, "doc.json"),
      JSON.stringify({
        media: [
          { id: "a", included: true },
          { id: "b", included: false },
        ],
      }),
    );
    expect(assembleDir(dir)).toBe(true);
    expect(readFileSync(join(dir, "doc.md"), "utf8")).toBe(
      "# T\n\n## 1 Un <!-- § 1 -->\n\nTexte.\n\n# Annexe — A <!-- § lot-a -->\n\nNeuf.\n",
    );
    expect(assembleDir(dir)).toBe(false);
    rmSync(join(dir, "doc.md"));
    rmSync(join(dir, "body.md"));
    expect(bodyOf(dir)).toBeNull();
    expect(assembleDir(dir)).toBe(false);
  });

  it("parses a reply's sections, dropping what is not an anchor", () => {
    expect(
      parseMedia('```media\n{"lot-a.p1": {"description": "Un écran.", "sections": ["5.6.6", "§ 5.6.7", 3]}}\n```'),
    ).toEqual({ "fig:lot-a.p1": { description: "Un écran.", sections: ["§5.6.6", "§5.6.7"] } });
  });
});
