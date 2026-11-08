import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIGURES_MARKER, FIGURES_TAG } from "../claude/figures.ts";
import { GEN_MARKER, PLAN_MARKER, PLAN_TAG, REPORT_TAG } from "../claude/gen-prompt.ts";
import { HEADERS_MARKER, HEADERS_TAG } from "../claude/headers.ts";
import { attachImage } from "../commands/images.ts";
import type { ClaudeSpawn } from "../env.ts";
import { newLocalId } from "../lib/store.ts";
import { mockStream, registerMockScript } from "./claude.ts";

const DOC = "SOSIE_211_D401-1_3";

const menuTest = (folder: string) => `---
project: LFRPS12
summary: Sectionneur sans TK — menu contextuel, propriétés et ouverture
folder: ${folder}
labels: []
review: draft
---

## Description

Vérifie la représentation, le menu contextuel, la fenêtre Propriétés et l'ouverture d'un sectionneur sans télécommande (TK). Technique boîte noire : cas d'utilisation de l'opérateur.

## Step 1

### Action

Sur la vue synoptique principale, repérer un sectionneur sans TK sur la schématique de traction.

### Expected Result

Le sectionneur est représenté par le symbole du sectionneur : un carré blanc cerclé de noir sur le trait de la caténaire.

### Sources

- ${DOC}#§5.6.6 "Le sectionneur est représenté sur la schématique de traction par le symbole de la Figure 40"
- ${DOC}#fig:40 "Représentation graphique sectionneur"

## Step 2

### Action

Clic droit sur le sectionneur sans TK.

### Expected Result

Le menu contextuel propose : Propriétés, Autoriser l'ouverture, Annuler l'autorisation d'ouverture, Confirmer l'ouverture, Autoriser la fermeture, Annuler l'autorisation de fermeture, Confirmer la fermeture.

### Sources

- ${DOC}#§5.6.6 "Le menu contextuel d'un sectionneur sans TK propose : Propriétés, Autoriser l'ouverture"

## Step 3

### Action

Choisir Propriétés dans le menu contextuel.

### Expected Result

La fenêtre Propriétés affiche l'état de la position, les heures de la dernière autorisation et confirmation d'ouverture et de fermeture, et les points kilométriques voie 1 et voie 2.

### Sources

- ${DOC}#§5.6.6 "La fenêtre Propriétés affiche l'état de la position"

## Step 4

### Action

Fermer la fenêtre Propriétés, puis choisir Autoriser l'ouverture et Confirmer l'ouverture dans le menu contextuel.

### Expected Result

Le symbole du sectionneur montre l'état ouvert sur la schématique, sans qu'aucune fenêtre ne s'ouvre.

### Sources

- ${DOC}#§5.6.6 "L'état ouvert ou fermé du sectionneur est visible sans ouvrir de fenêtre"
`;

const tkTest = (folder: string, partial: boolean) => `---
project: LFRPS12
summary: Sectionneur avec TK — menu contextuel réduit à Propriétés
folder: ${folder}
labels: []
review: draft
---

## Description

Vérifie qu'un sectionneur avec télécommande (TK) manœuvré régulièrement ne propose pas les commandes d'autorisation et de confirmation. Technique boîte noire : partition par type de sectionneur (chemin négatif).

## Step 1

### Action

Clic droit sur un sectionneur avec TK manœuvré régulièrement.

### Expected Result

Le menu contextuel ne propose que Propriétés : aucune commande d'autorisation ni de confirmation n'apparaît.

### Sources

- ${DOC}#§5.6.6 "un sectionneur avec TK ne propose que Propriétés"

## Step 2

### Action

Choisir Propriétés.

### Expected Result

La fenêtre Propriétés affiche l'état de la position et les points kilométriques voie 1 et voie 2.

### Sources

- ${DOC}#§5.6.6 "La fenêtre Propriétés affiche l'état de la position"
${
  partial
    ? `- ${DOC}#§5.6.7 "les points kilométriques voie 1 et voie 2"
`
    : ""
}`;

const NO_SOURCE = "Pas de source pour le résultat attendu";

const SKIPPED = [
  {
    item: "Manœuvre à distance d'un sectionneur avec TK",
    category: NO_SOURCE,
    why: "context.md : les sectionneurs avec TK ne sont pas encore câblés dans le simulateur ; aucun document ne décrit le résultat attendu.",
    sources: ['SOSIE_211_D401-1_3#§5.6.6 "un sectionneur avec TK manœuvré régulièrement ne propose que Propriétés"'],
  },
  {
    item: "Défaut de la TK pendant la manœuvre",
    category: NO_SOURCE,
    why: "Le §5.6.6 nomme le défaut de la TK mais ne dit pas ce que l'écran montre alors.",
  },
  {
    item: "EXI_MOP_SPF_510_A_20",
    category: "Hors du périmètre demandé",
    why: "Le TCO à deux rangées ne concerne pas le sectionneur.",
  },
];

// ponytail: a run adding to a generation writes a test for the first item it was told the generation could not write,
// names it under « covered », and reports the others again
const coveredItem = (prompt: string) => prompt.match(/^Items it could not write before[^\n]*\n- (.+?) \(/m)?.[1];

// ponytail: test i of the run as Claude saves it — its first steps, then the whole test — so the Generate page sees a
// test grow while it is written
function writeTest(spawn: ClaudeSpawn, ids: string[], i: number, steps?: number): void {
  const folder = spawn.stdin.match(/^Target Xray folder: (\/\S*)\s*$/m)?.[1] ?? "/Traction/Sectionneurs";
  const body = [menuTest(folder), tkTest(folder, partialRead(spawn.stdin))][i];
  const cut = steps === undefined ? -1 : body.indexOf(`## Step ${steps + 1}\n`);
  mkdirSync(join(spawn.cwd, "tests", ids[i]), { recursive: true });
  writeFileSync(join(spawn.cwd, "tests", ids[i], "test.md"), cut < 0 ? body : body.slice(0, cut), "utf8");
}

// ponytail: a request about the sectionneur « avec TK » reads only §5.6.6 of doc.md and cites one quote under the
// wrong section — the Review screen's evidence state; any other request reads the whole document and cites every
// quote where it is
function partialRead(prompt: string): boolean {
  return /avec TK/i.test(prompt);
}

registerMockScript(
  (prompt) => prompt.includes(GEN_MARKER) && prompt.includes(REPORT_TAG),
  (spawn) => {
    const ids = [newLocalId(), newLocalId()];
    const file = (id: string) => join(spawn.cwd, "tests", id, "test.md");
    const covered = coveredItem(spawn.stdin);
    const report = {
      tests: ids,
      skipped: SKIPPED.filter((s) => s.item !== covered),
      ...(covered ? { covered: [covered] } : {}),
    };
    const reply = [
      `Tests écrits : ${ids[0]} (sectionneur sans TK, 4 steps), ${ids[1]} (sectionneur avec TK, chemin négatif, 2 steps).`,
      "Non testé : la manœuvre à distance d'un sectionneur avec TK (non câblée dans le simulateur).",
      "",
      "```" + REPORT_TAG,
      JSON.stringify(report),
      "```",
    ].join("\n");
    return mockStream(spawn, {
      tools: [
        { name: "Skill", input: { skill: "generate-tests" } },
        { name: "mcp__testimus__rag_search", input: { query: "sectionneur menu contextuel" } },
        { name: "mcp__testimus__rag_search", input: { query: "fenêtre Propriétés sectionneur" } },
        { name: "mcp__testimus__rag_passage", input: { ref: `${DOC}#§5.6.6` } },
        { name: "mcp__testimus__rag_figure", input: { docId: DOC, n: "40" } },
        {
          name: "Read",
          input: { file_path: `docs/${DOC}/doc.md`, ...(partialRead(spawn.stdin) ? { offset: 13, limit: 14 } : {}) },
        },
        {
          name: "mcp__testimus__tests_create",
          input: { summary: "Sectionneur sans TK" },
          does: () => writeTest(spawn, ids, 0, 2),
        },
        { name: "mcp__testimus__tests_save", input: { id: ids[0], test: "…" } },
        { name: "mcp__testimus__tests_edit", input: { id: ids[0], step: 3 }, does: () => writeTest(spawn, ids, 0) },
        {
          name: "mcp__testimus__tests_addImage",
          input: { id: ids[0], step: 1, figure: `${DOC}#fig:40` },
          does: () => {
            try {
              attachImage(spawn.cwd, { id: ids[0], step: 1, figure: `${DOC}#fig:40` });
            } catch {}
          },
        },
        {
          name: "mcp__testimus__tests_create",
          input: { summary: "Sectionneur avec TK" },
          does: () => writeTest(spawn, ids, 1, 1),
        },
        { name: "Write", input: { file_path: file(ids[1]), content: "…" }, does: () => writeTest(spawn, ids, 1) },
        { name: "mcp__testimus__check_run", input: { ids } },
      ],
      texts: [
        "J'ai lu le §5.6.6 et la Figure 40. ",
        "Deux tests : le sectionneur sans TK (chemin positif) et le sectionneur avec TK (chemin négatif).\n\n",
        reply,
      ],
      result: reply,
      costUsd: 0.4211,
    });
  },
);

// ponytail: a scope past 15 sections gets a two-test plan, each planned run being the script above; a smaller one is
// written in one run, as a Claude that read it whole would — the fixture's requests keep their one-run story
const MOCK_PLAN_ABOVE = 15;
const scopeSize = (prompt: string) => Number(prompt.match(/The scope holds (\d+) sections?/)?.[1] ?? 0);
registerMockScript(
  (prompt) => prompt.includes(GEN_MARKER) && prompt.includes(PLAN_MARKER) && scopeSize(prompt) > MOCK_PLAN_ABOVE,
  (spawn) => {
    const plan = {
      tests: [
        {
          summary: "Sectionneur sans TK — menu contextuel et ouverture",
          technique: "cas d'utilisation",
          sections: [`${DOC}#§5.6.6`],
        },
        {
          summary: "Sectionneur avec TK — refus de la manœuvre locale",
          technique: "chemin négatif",
          sections: [`${DOC}#§5.6.6`],
        },
      ],
      skipped: SKIPPED,
    };
    const reply = `Plan : 2 tests.\n\n\`\`\`${PLAN_TAG}\n${JSON.stringify(plan)}\n\`\`\``;
    return mockStream(spawn, {
      tools: [
        { name: "Skill", input: { skill: "plan-tests" } },
        { name: "mcp__testimus__docs_show", input: { id: DOC } },
        { name: "Read", input: { file_path: `docs/${DOC}/doc.md` } },
      ],
      texts: [reply],
      result: reply,
      costUsd: 0.1204,
    });
  },
);

registerMockScript(
  (prompt) => prompt.includes(FIGURES_MARKER),
  (spawn) => {
    const anchors = [...spawn.stdin.matchAll(/^- (fig:\S+) — (\S+)/gm)];
    const out: Record<string, { description: string }> = {};
    for (const [, anchor, file] of anchors)
      out[anchor] = {
        description: `Description simulée de ${file.split("/").pop()} : un symbole et ses libellés, tel que l'écran les montre.`,
      };
    const reply = ["```" + FIGURES_TAG, JSON.stringify(out, null, 2), "```"].join("\n");
    return mockStream(spawn, {
      tools: anchors.map(([, , file]) => ({ name: "Read", input: { file_path: file } })),
      texts: [reply],
      result: reply,
      costUsd: 0.0311,
      delayMs: 40,
    });
  },
);

registerMockScript(
  (prompt) => prompt.includes(HEADERS_MARKER),
  (spawn) => {
    const out: Record<string, string> = {};
    for (const [, id, where] of spawn.stdin.matchAll(/^=== (\S+) \((.*)\)$/gm))
      out[id] = `Ce passage du document situe ${where} dans la traction de la ligne.`;
    const reply = ["```" + HEADERS_TAG, JSON.stringify(out), "```"].join("\n");
    return mockStream(spawn, { texts: [reply], result: reply, delayMs: 10 });
  },
);
