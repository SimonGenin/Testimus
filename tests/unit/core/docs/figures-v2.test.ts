import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { describeFigures, figuresPrompt, parseFigures } from "../../../../src/core/claude/figures.ts";
import { quietCtx } from "../../../../src/core/command.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { type ClaudeOut, env } from "../../../../src/core/env.ts";
import { mechanicalCheck } from "../../../../src/core/lib/check.ts";
import { DEFAULT_SETTINGS, readJson, writeSettings } from "../../../../src/core/lib/project.ts";
import { chunkDoc, docFigures, LABELS_PREFIX } from "../../../../src/core/rag/chunk.ts";
import { insertChunk, openDb } from "../../../../src/core/rag/db.ts";
import { bm25 } from "../../../../src/core/rag/search/lexical.ts";
import type { DocJson, FigureEntry } from "../../../../src/core/types.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const D3 = "SOSIE_211_D401-1_3";
const CAPTION = "Figure 40 – Représentation graphique sectionneur";
const real = env.spawnClaude;
let dir: string;

const figFile = () => join(dir, "docs", D3, "figures.json");
const figuresOf = () => readJson<FigureEntry[]>(figFile(), []);
const md = () => readFileSync(join(dir, "docs", D3, "doc.md"), "utf8");
const v2: FigureEntry = {
  file: "figures/fig-40.png",
  anchor: "fig:40",
  caption: CAPTION,
  description: "Symbole du sectionneur : un carré blanc sur le trait sarcelle.",
  labels: ["Autoriser l'ouverture", "Bloquer la manœuvre", "S 12"],
  kind: "symbol",
};

function reply(text: string) {
  env.spawnClaude = async (s): Promise<ClaudeOut> => {
    const l = JSON.stringify({ type: "result", subtype: "success", is_error: false, result: text, duration_ms: 5 });
    s.onLine?.(l);
    return { code: 0, stdout: `${l}\n`, stderr: "" };
  };
}

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-figures-v2-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
});

afterEach(() => {
  env.spawnClaude = real;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("figure descriptions v2 — the reply", () => {
  it("reads a v2 reply: description, verbatim labels (deduplicated, spaces folded), a known kind only", () => {
    const text = [
      "```figures",
      JSON.stringify({
        "fig:40": {
          description: " Fenêtre. ",
          labels: ["Valider", " Valider ", "Mise  hors tension", 3, ""],
          kind: "screen",
        },
        "41": { description: "Un plan.", labels: [], kind: "map" },
        "fig:42": { description: "", labels: ["X"] },
      }),
      "```",
    ].join("\n");
    expect(parseFigures(text)).toEqual({
      "fig:40": { description: "Fenêtre.", labels: ["Valider", "Mise hors tension"], kind: "screen" },
      "fig:41": { description: "Un plan.", labels: [] },
    });
  });

  it("no longer reads a v1 reply (anchor → description); reads a v2 list", () => {
    expect(parseFigures('```figures\n{"fig:40": "Un carré."}\n```')).toEqual({});
    expect(
      parseFigures(
        '```json\n[{"anchor": "fig:7", "description": "Trait vert.", "labels": ["DSO"], "kind": "diagram"}]\n```',
      ),
    ).toEqual({ "fig:7": { description: "Trait vert.", labels: ["DSO"], kind: "diagram" } });
  });

  it("asks Claude to Read each picture and give its description, its visible text verbatim and its kind", () => {
    const p = figuresPrompt(
      { id: D3, code: D3, title: "Traction" },
      [{ anchor: "fig:40", file: "figures/fig-40.png", caption: CAPTION, section: "5.6.6 Sectionneur (S)" }],
      "fr",
    );
    expect(p).toContain("Open each picture below with Read");
    expect(p).toMatch(/labels: every text visible in the picture, copied verbatim/);
    expect(p).toContain("kind: one of screen, diagram, symbol, table-image, photo");
    expect(p).toContain('"fig:40": {"description": "…", "labels": ["…"], "kind": "screen"}');
    expect(p).toContain("in French");
  });
});

describe("figure descriptions v2 — figures.json", () => {
  it("reads v1 and v2 entries side by side", () => {
    const v1 = { file: "figures/fig-41.png", anchor: "fig:41", caption: "Figure 41", description: "Un rond." };
    const figs = docFigures(md(), [v2, v1]);
    expect(figs.find((f) => f.anchor === "fig:40")).toMatchObject({ labels: v2.labels, kind: "symbol" });
    const old = figs.find((f) => f.anchor === "fig:41");
    expect(old).toMatchObject({ description: "Un rond." });
    expect(old?.labels).toBeUndefined();
    expect(old?.kind).toBeUndefined();
  });

  it("describeFigures writes labels and kind from a v2 reply; a later description-only reply keeps them", async () => {
    writeFileSync(
      figFile(),
      JSON.stringify([{ file: "figures/fig-40.png", anchor: "fig:40", caption: CAPTION, description: "" }]),
    );
    reply(
      `\`\`\`figures\n${JSON.stringify({ "fig:40": { description: "Un carré.", labels: ["S 12"], kind: "symbol" } })}\n\`\`\``,
    );
    const r = await describeFigures(dir, D3, quietCtx(dir));
    expect(r).toMatchObject({ described: 1, missing: [] });
    expect(figuresOf()).toEqual([
      {
        file: "figures/fig-40.png",
        anchor: "fig:40",
        caption: CAPTION,
        description: "Un carré.",
        labels: ["S 12"],
        kind: "symbol",
      },
    ]);
    reply('```figures\n{"fig:40": {"description": "Un carré blanc."}}\n```');
    await describeFigures(dir, D3, quietCtx(dir), { force: true });
    expect(figuresOf()[0]).toMatchObject({ description: "Un carré blanc.", labels: ["S 12"], kind: "symbol" });
  });

  it("docs.describeFigures with anchors describes those figures again, and only those; anchors needs a document", async () => {
    writeFileSync(figFile(), JSON.stringify([v2]));
    reply('```figures\n{"fig:40": {"description": "Un carré relu."}}\n```');
    let prompt = "";
    const spawn = env.spawnClaude;
    env.spawnClaude = async (s) => {
      prompt = s.stdin ?? "";
      return spawn(s);
    };
    const none = (await invoke("docs.describeFigures", { docId: D3, anchors: [] }, { project: dir })) as {
      docs: { described: number }[];
    };
    expect(none.docs[0].described).toBe(0);
    expect(prompt).toBe("");
    const r = (await invoke("docs.describeFigures", { docId: D3, anchors: ["fig:40"] }, { project: dir })) as {
      docs: { described: number; missing: string[] }[];
    };
    expect(r.docs[0]).toMatchObject({ described: 1, missing: [] });
    expect(prompt).toContain("fig:40");
    expect(figuresOf()[0]).toMatchObject({ description: "Un carré relu.", labels: v2.labels, kind: "symbol" });
    await expect(invoke("docs.describeFigures", { anchors: ["fig:40"] }, { project: dir })).rejects.toThrow(/docId/);
  });

  it("docs.show lists the labels and the kind of a figure", async () => {
    writeFileSync(figFile(), JSON.stringify([v2]));
    const r = (await invoke("docs.show", { id: D3 }, { project: dir })) as { figures: FigureEntry[] };
    expect(r.figures[0]).toMatchObject({ labels: v2.labels, kind: "symbol" });
  });
});

describe("figure descriptions v2 — search and sources", () => {
  const doc = { id: D3, code: D3, title: "Traction" } as DocJson;

  it("puts the labels in the figure chunk's text; a v1 figure has no labels line", () => {
    const fig = chunkDoc(doc, md(), [v2]).find((c) => c.kind === "figure");
    expect(fig?.text).toBe(
      `${CAPTION}\n${v2.description}\n${LABELS_PREFIX} Autoriser l'ouverture · Bloquer la manœuvre · S 12`,
    );
    const old = chunkDoc(doc, md(), [{ ...v2, labels: undefined, kind: undefined }]).find((c) => c.kind === "figure");
    expect(old?.text).toBe(`${CAPTION}\n${v2.description}`);
  });

  it("BM25 finds the picture by a word that is only on it", () => {
    const db = openDb(join(dir, "index", "rag.db"));
    try {
      const ids = new Map<number, string>();
      for (const c of chunkDoc(doc, md(), [v2])) ids.set(insertChunk(db, c, c.id), c.id);
      const hits = bm25(db, "bloquer la manœuvre", {}).map((r) => ids.get(r));
      expect(hits[0]).toBe(`${D3}#fig:40`);
      const before = openDb(join(dir, "index", "v1.db"));
      try {
        const v1 = new Map<number, string>();
        for (const c of chunkDoc(doc, md(), [{ ...v2, labels: undefined }])) v1.set(insertChunk(before, c, c.id), c.id);
        expect(bm25(before, "bloquer la manœuvre", {}).map((r) => v1.get(r))).not.toContain(`${D3}#fig:40`);
      } finally {
        before.close();
      }
    } finally {
      db.close();
    }
  });

  it("a label is never quotable: a fig:N citation is checked against the caption in doc.md only", () => {
    writeFileSync(figFile(), JSON.stringify([v2]));
    expect(mechanicalCheck(dir, "LFRPS12-1420").map((f) => f.kind)).toEqual(["source-missing"]);
    const test = join(dir, "tests", "LFRPS12-1420", "test.md");
    const src = readFileSync(test, "utf8");
    writeFileSync(test, src.replace(`#fig:40 "${CAPTION}"`, '#fig:40 "Bloquer la manœuvre"'));
    expect(mechanicalCheck(dir, "LFRPS12-1420").map((f) => f.kind)).toContain("quote-not-found");
    writeFileSync(test, src.replace(`#fig:40 "${CAPTION}"`, '#fig:40 "un carré blanc sur le trait sarcelle"'));
    expect(mechanicalCheck(dir, "LFRPS12-1420").map((f) => f.kind)).toContain("quote-not-found");
  });
});
