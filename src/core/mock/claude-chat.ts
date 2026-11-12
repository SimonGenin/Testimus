import { LEARN_MARKER } from "../claude/learn.ts";
import type { ClaudeSpawn } from "../env.ts";
import { stepColumns } from "../lib/columns.ts";
import { learnConversations, listContexts, showContext } from "../lib/contexts.ts";
import { readOverview } from "../lib/overview.ts";
import { propose } from "../lib/proposals.ts";
import type { ProposalKind } from "../types.ts";
import { mockStream, registerMockScript } from "./claude.ts";

const runIdOf = (prompt: string) => prompt.match(/runId: "([\w-]+)"/)?.[1] ?? "";
const questionOf = (prompt: string) => prompt.match(/^Question: (.*)$/m)?.[1] ?? "";

// ponytail: a question that asks to correct the overview, a context or a column gets a proposal, as the real run would
// call docs_overviewPropose, contexts_propose or columns_propose — the fixture has no context, so the first one saved
function asked(q: string): ProposalKind | null {
  if (!/corrig|correct|fix|modifi|change/i.test(q)) return null;
  if (/vue d'ensemble|overview/i.test(q)) return "overview";
  if (/\b(contexte|context)\b/i.test(q)) return "context";
  if (/\b(colonne|column)\b/i.test(q)) return "column";
  return null;
}

function proposal(cwd: string, kind: ProposalKind, runId: string): { tool: string; text: string; does: () => void } {
  if (kind === "overview") {
    const before = readOverview(cwd).body.trim();
    const after = before
      ? before.replace(
          /\n## /,
          "\n## Le poste de commande\n\nLe TCO et le PCC décrivent le même poste vu de deux places.\n\n## ",
        )
      : "## Le poste de commande\n\nLe TCO et le PCC décrivent le même poste vu de deux places.\n";
    const why = "Les documents décrivent le même poste depuis le TCO et le PCC : la vue d'ensemble ne le disait pas.";
    return {
      tool: "mcp__testimus__docs_overviewPropose",
      text: "Je propose d'ajouter à la vue d'ensemble une section sur le poste de commande.",
      does: () => propose(cwd, { kind, target: "overview", after, why, runId }),
    };
  }
  if (kind === "context") {
    const c = listContexts(cwd).find((x) => !x.shared);
    const notes = c ? showContext(cwd, c.id).notes.trim() : "";
    return {
      tool: "mcp__testimus__contexts_propose",
      text: c
        ? `Je propose de préciser le contexte « ${c.name} » : TCO veut dire tableau de contrôle optique.`
        : "Aucun contexte n'est enregistré dans ce projet : il n'y a rien à corriger.",
      does: () =>
        c &&
        propose(cwd, {
          kind,
          target: c.id,
          after: `${notes}\n\n- TCO : tableau de contrôle optique.`.trim(),
          why: "La conversation a tranché ce que veut dire TCO.",
          runId,
        }),
    };
  }
  const col = stepColumns(cwd).find((c) => c.name === "Expected Result");
  return {
    tool: "mcp__testimus__columns_propose",
    text: "Je propose que la colonne Expected Result liste une observation par ligne.",
    does: () =>
      propose(cwd, {
        kind,
        target: "Expected Result",
        after: `${col?.description ?? ""} One observation per line.`.trim(),
        why: "Les tests tirés de Xray écrivent une observation par ligne.",
        runId,
      }),
  };
}

// ponytail: a long answer in Markdown — titles, lists, a table, code, a quote — so the dock's rendering can be seen
const LONG = [
  "## Le menu contextuel d'un sectionneur\n\n",
  'Le menu **dépend du type** de sectionneur [SOSIE_211_D401-1_3#§5.6.6 "Selon le type de sectionneur, le menu contextuel diffère"].\n\n',
  "### Sans télécommande (TK)\n\n",
  "- *Propriétés*, toujours présent ;\n",
  "- les commandes d'**autorisation** d'ouverture et de fermeture ;\n",
  "  - puis leur **confirmation**.\n\n",
  "### Ce qu'il faut tester\n\n",
  "1. Ouvrir le menu sur un sectionneur sans TK.\n",
  "2. Vérifier les entrées, dans l'ordre affiché.\n\n",
  "| Type | Entrées |\n| --- | --- |\n| Sans TK | Propriétés, autorisation, confirmation |\n| Avec TK | Propriétés, commande directe |\n\n",
  "> Les documents ne précisent pas l'ordre d'affichage des commandes.\n\n",
  "La commande du mock est `menu.sectionneur`, par exemple :\n\n```\nouvrir --sectionneur S12 --type sans-tk\n```\n",
];

registerMockScript(
  (prompt) => prompt.includes("ask-docs") && (!!asked(questionOf(prompt)) || /markdown|long/i.test(questionOf(prompt))),
  (spawn: ClaudeSpawn) => {
    const kind = asked(questionOf(spawn.stdin));
    if (!kind) return mockStream(spawn, { texts: LONG, result: LONG.join(""), delayMs: 60 });
    const p = proposal(spawn.cwd, kind, runIdOf(spawn.stdin));
    return mockStream(spawn, {
      tools: [{ name: p.tool, input: { runId: runIdOf(spawn.stdin) }, does: p.does }],
      texts: [p.text],
      result: p.text,
      delayMs: 60,
    });
  },
);

// ponytail: the learning run keeps one line per exchange — the question, said as settled — and condenses to the last
// lines it has room for, as the rules say
registerMockScript(
  (prompt) => prompt.startsWith(LEARN_MARKER),
  (spawn: ClaudeSpawn) => {
    const today = spawn.stdin.match(/\nThe context today:\n([\s\S]*?)\n\nThe last exchange:/)?.[1] ?? "";
    const question = (spawn.stdin.match(/^User: (.*)$/m)?.[1] ?? "").replace(/[#\d/]/g, " ").replace(/\s+/g, " ");
    const kept = today.startsWith("(empty") ? [] : today.split("\n").filter((l) => l.startsWith("- "));
    const text = ["## Questions réglées", "", ...[...kept, `- ${question.slice(0, 160).trim()}`].slice(-12)].join("\n");
    const said = "J'ai gardé la question réglée par cet échange.";
    return mockStream(spawn, {
      tools: [
        { name: "mcp__testimus__contexts_learn", input: { text }, does: () => learnConversations(spawn.cwd, text) },
      ],
      texts: [said],
      result: said,
      delayMs: 40,
    });
  },
);
