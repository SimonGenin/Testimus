import { ANALYZE_MARKER } from "../claude/analyze.ts";
import { invoke } from "../commands/index.ts";
import type { ProposalIn, RecordIn, Unfound } from "../lib/analysis.ts";
import { itemsOf, readAnalysis } from "../lib/analysis.ts";
import { loadCorpus } from "../lib/check.ts";
import { stepColumns } from "../lib/columns.ts";
import { readTest, testExists } from "../lib/store.ts";
import type { Test } from "../types.ts";
import { mockStream, registerMockScript } from "./claude.ts";

const DOC = "SOSIE_211_D401-1_3";
const TK_QUOTE = "un sectionneur avec TK manœuvré régulièrement ne propose que Propriétés";
const SECTION = /<!--\s*§\s*(\S+?)\s*-->/;

// ponytail: where a code is stated — the section above the line that starts with it, and the words after « CODE : »
function stated(project: string, item: string): { docId: string; anchor: string; quote: string } | null {
  for (const d of new Set(loadCorpus(project).docs.values())) {
    let anchor = "";
    for (const line of d.md.split(/\r?\n/)) {
      const s = SECTION.exec(line);
      if (s) anchor = `§${s[1]}`;
      if (anchor && line.startsWith(`${item} :`)) {
        const quote = line
          .slice(item.length + 2)
          .trim()
          .split(/\s+/)
          .slice(0, 8)
          .join(" ");
        return { docId: d.id, anchor, quote };
      }
    }
  }
  return null;
}

export function mockAnalysis(project: string, test: Test): RecordIn {
  const kept = stepColumns(project).filter((c) => !c.builtin);
  const proposals: ProposalIn[] = [];
  const unfound: Unfound[] = [];
  test.steps.forEach((s, i) => {
    const step = i + 1;
    for (const c of kept)
      for (const item of itemsOf(s.fields[c.name] ?? "")) {
        if (s.sources.some((x) => x.column === c.name && x.item === item)) continue;
        const at = stated(project, item);
        if (!at) {
          unfound.push({ step, column: c.name, item, why: "Absent de tous les documents (rag_mentions, Grep)." });
          continue;
        }
        proposals.push({
          kind: "source",
          step,
          title: `Lier ${item} à son passage`,
          why: `Le ${at.anchor} énonce ${item}.`,
          sources: [`${at.docId}#${at.anchor} "${at.quote}" @${c.name} "${item}"`],
        });
      }
    const expected = (s.fields["Expected Result"] ?? "").trim();
    if (/pas simulée?/i.test(expected) && !s.sources.length)
      proposals.push({
        kind: "remove",
        step,
        title: `Retirer le step ${step}`,
        why: "Aucun document ne dit que la traction n'est pas simulée.",
      });
  });
  if (/sans TK/i.test(test.summary))
    proposals.push({
      kind: "step",
      after: test.steps.length,
      title: "Vérifier le menu d'un sectionneur avec TK",
      why: "Le §5.6.6 distingue le sectionneur avec TK ; aucun step ne le vérifie.",
      fields: {
        Action: "Clic droit sur un sectionneur avec TK manœuvré régulièrement.",
        "Expected Result": "Le menu contextuel ne propose que Propriétés.",
      },
      sources: [`${DOC}#§5.6.6 "${TK_QUOTE}"`],
    });
  const columns = kept
    .filter((c) => test.steps.some((s) => (s.fields[c.name] ?? "").trim()))
    .map((c) => ({ name: c.name, role: "keep" as const, why: "Codes d'exigence saisis par l'équipe." }));
  return {
    summary: proposals.length
      ? `Le test suit ${DOC}#§5.6.6 "${TK_QUOTE}" ; ${proposals.length} proposition(s) pour le relier aux documents.`
      : "Le test est conforme aux documents.",
    columns: [...columns, { name: "Expected Result", role: "open", why: "Texte libre." }],
    unfound,
    proposals,
  };
}

registerMockScript(
  (prompt) => prompt.includes(ANALYZE_MARKER),
  (spawn) => {
    const id = new RegExp(`${ANALYZE_MARKER} ([A-Za-z0-9._-]+)\\.`).exec(spawn.stdin)?.[1] ?? "";
    let n = 0;
    return mockStream(spawn, {
      delayMs: 60,
      tools: [
        { name: "Skill", input: { skill: "analyze-test" } },
        { name: "mcp__testimus__tests_show", input: { id } },
        { name: "mcp__testimus__columns_list", input: {} },
        { name: "mcp__testimus__rag_passage", input: { ref: `${DOC}#§5.6.6` } },
        { name: "mcp__testimus__analysis_record", input: { id } },
      ],
      edit: () => {
        if (!testExists(spawn.cwd, id)) return;
        const prev = readAnalysis(spawn.cwd, id);
        const refused = new Set([
          ...(prev?.earlier ?? []).map((e) => e.title),
          ...(prev?.proposals ?? []).filter((p) => p.state === "rejected").map((p) => p.title),
        ]);
        const all = mockAnalysis(spawn.cwd, readTest(spawn.cwd, id).test);
        const record = { ...all, proposals: all.proposals.filter((p) => !refused.has(p.title)) };
        n = record.proposals.length;
        invoke("analysis.record", { id, ...record }, { project: spawn.cwd }).catch(() => {});
      },
      texts: ["J'ai relu chaque step avec les passages. "],
      get result() {
        return `${n} proposition(s).`;
      },
    });
  },
);
