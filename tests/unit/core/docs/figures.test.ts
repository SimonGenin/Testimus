import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  describeFigures,
  FIGURES_MARKER,
  figuresPrompt,
  parseFigures,
  shouldDescribeFigures,
} from "../../../../src/core/claude/figures.ts";
import { quietCtx } from "../../../../src/core/command.ts";
import { invoke } from "../../../../src/core/commands/index.ts";
import { type ClaudeOut, type ClaudeSpawn, env } from "../../../../src/core/env.ts";
import {
  DEFAULT_SETTINGS,
  readJson,
  readProject,
  writeProject,
  writeSettings,
} from "../../../../src/core/lib/project.ts";
import { mockSpawnClaude } from "../../../../src/core/mock/claude.ts";
import "../../../../src/core/mock/claude-gen.ts";
import type { FigureEntry } from "../../../../src/core/types.ts";

const FIXTURE = join(import.meta.dirname, "..", "..", "..", "fixtures", "project");
const D3 = "SOSIE_211_D401-1_3";
const real = env.spawnClaude;
let dir: string;
let seen: ClaudeSpawn[];

const figuresOf = () => readJson<FigureEntry[]>(join(dir, "docs", D3, "figures.json"), []);

function fake(reply: string, ok = true) {
  env.spawnClaude = async (s): Promise<ClaudeOut> => {
    seen.push(s);
    const l = JSON.stringify({
      type: "result",
      subtype: ok ? "success" : "error_during_execution",
      is_error: !ok,
      result: reply,
      duration_ms: 5,
      total_cost_usd: 0.02,
    });
    s.onLine?.(l);
    return { code: ok ? 0 : 1, stdout: `${l}\n`, stderr: "" };
  };
}

beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), "testimus-figures-")), "LFRPS12");
  cpSync(FIXTURE, dir, { recursive: true });
  seen = [];
  writeSettings({ ...DEFAULT_SETTINGS, claude: { exe: "C:/bin/claude.exe" } });
});

afterEach(() => {
  env.spawnClaude = real;
  rmSync(join(dir, ".."), { recursive: true, force: true });
});

describe("figure descriptions", () => {
  it("parses the figures block (object or list, with or without the fig: prefix)", () => {
    expect(
      parseFigures(
        'ok\n```figures\n{"fig:40": {"description": " Un carré. "}, "41": {"description": "Un rond."}, "fig:42": {"description": ""}}\n```',
      ),
    ).toEqual({
      "fig:40": { description: "Un carré." },
      "fig:41": { description: "Un rond." },
    });
    expect(parseFigures('```json\n[{"anchor": "fig:7", "description": "Trait vert."}]\n```')).toEqual({
      "fig:7": { description: "Trait vert." },
    });
    expect(parseFigures('{"fig:3": {"description": "Nu."}}')).toEqual({ "fig:3": { description: "Nu." } });
    expect(parseFigures("Je ne peux pas lire les images.")).toEqual({});
  });

  it("prompts with the marker, each picture's path, caption and section, and the language", () => {
    const p = figuresPrompt(
      { id: D3, code: D3, title: "Traction" },
      [
        {
          anchor: "fig:40",
          file: "figures/fig-40.png",
          caption: "Figure 40 – Représentation graphique sectionneur",
          section: "5.6.6 Sectionneur (S)",
        },
      ],
      "fr",
    );
    expect(p.startsWith(`${FIGURES_MARKER} for the document ${D3} Traction.`)).toBe(true);
    expect(p).toContain(
      `- fig:40 — docs/${D3}/figures/fig-40.png — caption: "Figure 40 – Représentation graphique sectionneur" — section 5.6.6 Sectionneur (S)`,
    );
    expect(p).toContain("in French");
    expect(p).toContain("```figures");
  });

  it("asks nothing when every figure already has a description", async () => {
    const r = await describeFigures(dir, D3, quietCtx(dir));
    expect(r).toMatchObject({ figures: 1, described: 0, missing: [] });
    expect(seen).toHaveLength(0);
  });

  it("describes the figures without a description (one read-only run) and writes figures.json", async () => {
    writeFileSync(
      join(dir, "docs", D3, "figures.json"),
      JSON.stringify([
        {
          file: "figures/fig-40.png",
          anchor: "fig:40",
          caption: "Figure 40 – Représentation graphique sectionneur",
          description: "",
        },
      ]),
    );
    fake('```figures\n{"fig:40": {"description": "Un carré blanc cerclé de noir sur un trait sarcelle."}}\n```');
    const r = await describeFigures(dir, D3, quietCtx(dir));
    expect(r).toMatchObject({ docId: D3, figures: 1, described: 1, missing: [], costUsd: 0.02 });
    expect(r.runIds).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].stdin).toContain(`docs/${D3}/figures/fig-40.png`);
    expect(seen[0].args[seen[0].args.indexOf("--tools") + 1]).toBe("Read");
    expect(figuresOf()).toEqual([
      {
        file: "figures/fig-40.png",
        anchor: "fig:40",
        caption: "Figure 40 – Représentation graphique sectionneur",
        description: "Un carré blanc cerclé de noir sur un trait sarcelle.",
      },
    ]);
  });

  it("runs with the project model at low effort, or with the model and effort picked", async () => {
    const args = (i: number) =>
      seen[i].args.slice(seen[i].args.indexOf("--model"), seen[i].args.indexOf("--model") + 4);
    fake("```figures\n{}\n```");
    await describeFigures(dir, D3, quietCtx(dir), { force: true });
    expect(args(0)).toEqual(["--model", readProject(dir).claude.model, "--effort", "low"]);
    seen = [];
    await invoke("docs.describeFigures", { docId: D3, force: true, model: "sonnet", effort: "medium" }, quietCtx(dir));
    expect(seen.map((_, i) => args(i))).toContainEqual(["--model", "sonnet", "--effort", "medium"]);
  });

  it("adds a figure doc.md shows but figures.json lacks; keeps the old file when Claude fails", async () => {
    writeFileSync(join(dir, "docs", D3, "figures.json"), "[]");
    fake("Rate limit reached", false);
    const logs: string[] = [];
    const failed = await describeFigures(dir, D3, { ...quietCtx(dir), log: (_l, m) => logs.push(m) });
    expect(failed).toMatchObject({ described: 0, missing: ["fig:40"] });
    expect(figuresOf()).toEqual([]);
    expect(logs.join("\n")).toMatch(/Rate limit/);

    fake('```figures\n{"fig:40": {"description": "Symbole du sectionneur."}}\n```');
    await describeFigures(dir, D3, quietCtx(dir));
    expect(figuresOf()).toEqual([
      {
        file: "figures/fig-40.png",
        anchor: "fig:40",
        caption: "Figure 40 – Représentation graphique sectionneur",
        description: "Symbole du sectionneur.",
      },
    ]);
  });

  it("docs.describeFigures --force runs over every document against the --mock Claude", async () => {
    env.spawnClaude = mockSpawnClaude;
    const r = (await invoke("docs.describeFigures", { force: true }, { project: dir })) as {
      docs: { docId: string; described: number; figures: number }[];
    };
    expect(r.docs.map((d) => [d.docId, d.figures, d.described])).toEqual([
      [D3, 1, 1],
      ["SOSIE_211_D401-1_4", 0, 0],
    ]);
    expect(figuresOf()[0].description).toMatch(/^Description simulée de fig-40.png/);
    await expect(invoke("docs.describeFigures", { docId: "nope" }, { project: dir })).rejects.toThrow(
      /No document nope/,
    );
  });

  it("is on by default, off when project.json rag.describeFigures is false", () => {
    expect(shouldDescribeFigures(dir)).toBe(true);
    const p = readProject(dir);
    writeProject(dir, { ...p, rag: { ...p.rag, describeFigures: false } as typeof p.rag });
    expect(shouldDescribeFigures(dir)).toBe(false);
    expect(readFileSync(join(dir, "project.json"), "utf8")).toContain('"describeFigures": false');
  });
});
