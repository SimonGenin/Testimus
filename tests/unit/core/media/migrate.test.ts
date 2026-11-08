import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { readCheck } from "../../../../src/core/lib/store.ts";
import type { DocJson, FigureEntry } from "../../../../src/core/types.ts";
import { call } from "../registry.ts";

const LEGACY = resolve(import.meta.dirname, "../../../fixtures/legacy-batch");
const PARENT = "SOSIE_211_D401-1_3";
const NEW = "SOSIE_211_D401-1_3-recette-tco-12-10";
const TEST = "local-0b5e7a11";
let P = "";

const read = (...p: string[]) => readFileSync(join(P, ...p), "utf8");
const doc = (id: string) => JSON.parse(read("docs", id, "doc.json")) as DocJson & { media?: unknown };

type Report = {
  migrated: { from: string; lot: string; doc: string; title: string; images: number }[];
  rewritten: { test: string; from: string; to: string }[];
  dryRun: boolean;
};

beforeEach(() => {
  P = mkdtempSync(join(tmpdir(), "testimus-migrate-"));
  cpSync(LEGACY, P, { recursive: true });
});

describe("media.migrate", () => {
  it("says with dryRun what would change, and changes nothing", async () => {
    const r = await call<Report>("media.migrate", { dryRun: true }, P);
    expect(r.migrated).toEqual([
      { from: PARENT, lot: "recette-tco-12-10", doc: NEW, title: "Recette TCO 12/10", images: 2 },
    ]);
    expect(r.rewritten.map((x) => x.to)).toEqual([`${NEW}#img:1`, `${NEW}#img:2`, `${NEW}#§media`]);
    expect(doc(PARENT).media).toBeDefined();
    expect(existsSync(join(P, "docs", NEW))).toBe(false);
  });

  it("turns each batch into an images document, rewrites the citing sources and leaves the parent as it was before", async () => {
    const r = await call<Report>("media.migrate", {}, P);
    expect(r.rewritten).toEqual([
      {
        test: TEST,
        from: `${PARENT}#§lot-recette-tco-12-10.img-0042`,
        to: `${NEW}#img:1`,
      },
      { test: TEST, from: `${PARENT}#fig:lot-recette-tco-12-10.img-0043`, to: `${NEW}#img:2` },
      { test: TEST, from: `${PARENT}#§lot-recette-tco-12-10`, to: `${NEW}#§media` },
    ]);
    const d = doc(NEW);
    expect(d).toMatchObject({ title: "Recette TCO 12/10", kind: "other", relatesTo: [PARENT] });
    expect(d.source).toMatchObject({ type: "images", file: "files", last: 2 });
    expect(d.source.files?.map((f) => [f.n, f.name, f.figure, f.state])).toEqual([
      [1, "IMG_0042.jpg", "figures/img-1.jpg", "analysed"],
      [2, "IMG_0043.jpg", "figures/img-2.jpg", "analysed"],
    ]);
    expect(readdirSync(join(P, "docs", NEW, "figures"))).toEqual(["img-1.jpg", "img-2.jpg"]);
    const figs = JSON.parse(read("docs", NEW, "figures.json")) as FigureEntry[];
    expect(figs[1]).toMatchObject({ anchor: "img:2", caption: "IMG_0043.jpg — 2026-10-12 14:05", kind: "screen" });
    expect(figs[1].labels).toContain("Type : sans télécommande (TK)");
    expect(read("docs", NEW, "context.md")).toContain("Photos du TCO réel prises pendant la recette du 12/10");
    expect(read("docs", NEW, "doc.md")).toContain("<!-- img 2 -->");
    const parent = doc(PARENT);
    expect(parent.media).toBeUndefined();
    expect(existsSync(join(P, "docs", PARENT, "media"))).toBe(false);
    expect(existsSync(join(P, "docs", PARENT, "body.md"))).toBe(false);
    expect(readdirSync(join(P, "docs", PARENT, "figures"))).toEqual(["fig-40.png"]);
    expect(read("docs", PARENT, "doc.md")).not.toContain("lot-");
    const test = read("tests", TEST, "test.md");
    expect(test).toContain(`- ${NEW}#img:1 "IMG_0042.jpg — 12/10/2026 14:03"`);
    expect(test).toContain(`- ${PARENT}#§5.6.6 "Le sectionneur est représenté sur la schématique de traction"`);
    const findings = readCheck(P, TEST)?.findings ?? [];
    expect(findings.filter((f) => f.kind === "source-missing")).toEqual([]);
    expect(findings.some((f) => f.kind === "quote-not-found" && f.sources.includes(`${NEW}#img:1`))).toBe(true);
  });

  it("is idempotent, and runs by itself the first time a command names the project", async () => {
    await call("docs.list", {}, P);
    expect(existsSync(join(P, "docs", NEW, "doc.json"))).toBe(true);
    const reports = readdirSync(join(P, ".testimus", "migrations"));
    expect(reports).toHaveLength(1);
    expect(JSON.parse(read(".testimus", "migrations", reports[0])).migrated[0].doc).toBe(NEW);
    const again = await call<Report>("media.migrate", {}, P);
    expect(again).toEqual({ migrated: [], rewritten: [], dryRun: false });
  });
});
