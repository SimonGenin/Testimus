import { quietCtx } from "../command.ts";
import { commands } from "../commands/check.ts";
import { fieldOrder, readXray } from "../lib/project.ts";
import { readCheck, readTest, testExists, writeTest } from "../lib/store.ts";
import type { Finding, Test } from "../types.ts";
import { mockStream, registerMockScript } from "./claude.ts";
import { mockPropose, runIdIn } from "./claude-actions.ts";

const DOC = "SOSIE_211_D401-1_3";
const TK_QUOTE = "un sectionneur avec TK manœuvré régulièrement ne propose que Propriétés";
const TK_RESULT = "Le menu contextuel ne propose que Propriétés.";

type Found = Omit<Finding, "pass">;

const idIn = (prompt: string, skill: string) =>
  new RegExp(`Use the ${skill} skill on the test ([A-Za-z0-9._-]+)\\.`).exec(prompt)?.[1];

export function mockFindings(test: Test): Found[] {
  const out: Found[] = [];
  test.steps.forEach((s, i) => {
    const step = i + 1;
    const expected = (s.fields["Expected Result"] ?? "").trim();
    if ((s.fields.Exigence ?? "").includes("EXI_MOP_SPF_510_A_20"))
      out.push({
        step,
        kind: "wrong-requirement",
        severity: "error",
        message: "EXI_MOP_SPF_510_A_20 porte sur le TCO à deux rangs, pas sur le menu contextuel testé par ce step.",
        sources: [`${DOC}#req:EXI_MOP_SPF_510_A_20`],
      });
    if (/pas simulée?/i.test(expected) && !s.sources.length)
      out.push({
        step,
        kind: "not-simulated-unsourced",
        severity: "error",
        message: `Le step ${step} affirme que la traction n'est pas simulée ; aucun passage ne le dit.`,
        sources: [],
      });
    if (expected && expected.split(/\s+/).length < 6)
      out.push({
        step,
        kind: "vague-result",
        severity: "warning",
        message: `« ${expected} » ne dit pas ce que le testeur doit voir : le §5.6.6 liste les commandes proposées selon le type de sectionneur.`,
        sources: [`${DOC}#§5.6.6`],
      });
  });
  const said = test.steps.map((s) => Object.values(s.fields).join(" ")).join(" ");
  if (/sans TK/i.test(test.summary) && !/avec TK/i.test(said))
    out.push({
      kind: "negative-missing",
      severity: "warning",
      message: "Aucun step ne vérifie qu'un sectionneur avec TK manœuvré régulièrement ne propose que Propriétés.",
      sources: [`${DOC}#§5.6.6`],
    });
  if (!out.length) {
    const first = test.steps.flatMap((s) => s.sources).find((x) => x.anchor);
    out.push({
      kind: "case-missing",
      severity: "info",
      message: "Le chapitre cité décrit aussi la fenêtre Propriétés de cet objet ; aucun step ne l'ouvre.",
      sources: [first ? `${first.docId}#${first.anchor}` : `${DOC}#§5.6.6`],
    });
  }
  return out.slice(0, 3);
}

function record(project: string, id: string, findings: Found[]): void {
  const c = commands.find((x) => x.name === "check.record");
  c?.run(quietCtx(project), c.input.parse({ id, findings }) as never).catch(() => {});
}

export function mockFix(project: string, id: string): string[] {
  const { test } = readTest(project, id);
  const findings = readCheck(project, id)?.findings ?? [];
  const changes: string[] = [];
  const asked = Number(/step\s+(\d+)/i.exec(test.reviewNote ?? "")?.[1] ?? 0);
  const target = asked || (findings.find((f) => f.kind === "vague-result" && f.step)?.step ?? 0);
  const step = test.steps[target - 1];
  if (step) {
    step.fields["Expected Result"] = TK_RESULT;
    step.sources = [{ docId: DOC, anchor: "§5.6.6", quote: TK_QUOTE }];
    changes.push(`step ${target}: le résultat attendu dit maintenant que seul Propriétés est proposé`);
  }
  for (const f of findings) {
    const s = f.kind === "wrong-requirement" && f.step ? test.steps[f.step - 1] : undefined;
    const bad = /EXI_\w+/.exec(f.message)?.[0];
    if (!s || !bad || !s.fields.Exigence?.includes(bad)) continue;
    s.fields.Exigence = s.fields.Exigence.split(/\s*,\s*/)
      .filter((r) => r !== bad)
      .join(", ");
    changes.push(`step ${f.step}: ${bad} retirée du champ Exigence`);
  }
  if (findings.some((f) => f.kind === "negative-missing")) {
    test.steps.push({
      fields: { Action: "Clic droit sur un sectionneur avec TK manœuvré régulièrement.", "Expected Result": TK_RESULT },
      sources: [{ docId: DOC, anchor: "§5.6.6", quote: TK_QUOTE }],
      images: [],
    });
    changes.push(`step ${test.steps.length} ajouté : le cas du sectionneur avec TK`);
  }
  if (changes.length) writeTest(project, id, test, fieldOrder(readXray(project)));
  return changes;
}

registerMockScript(
  (prompt) => prompt.includes("Use the check-test skill on the test"),
  (spawn) => {
    const id = idIn(spawn.stdin, "check-test") ?? "";
    let found: Found[] = [];
    return mockStream(spawn, {
      delayMs: 60,
      tools: [
        { name: "Skill", input: { skill: "check-test" } },
        { name: "mcp__testimus__tests_show", input: { id } },
        { name: "mcp__testimus__rag_passage", input: { ref: `${DOC}#§5.6.6` } },
        { name: "mcp__testimus__check_record", input: { id } },
      ],
      edit: () => {
        if (!testExists(spawn.cwd, id)) return;
        found = mockFindings(readTest(spawn.cwd, id).test);
        record(spawn.cwd, id, found);
        const vague = found.find((f) => f.kind === "vague-result" && f.step);
        const runId = runIdIn(spawn.stdin);
        if (vague && runId)
          mockPropose(spawn.cwd, {
            runId,
            problem: vague.message,
            title: `Make step ${vague.step} say what the menu shows`,
            why: "§5.6.6 lists what the menu of this object proposes.",
            plan: ["Read §5.6.6", "Rewrite the expected result", "Add the source line"],
            scope: { kind: "step", testId: id, step: vague.step },
          });
      },
      texts: ["J'ai relu chaque step avec le passage cité. ", "Les anomalies sont enregistrées."],
      get result() {
        const n = (s: string) => found.filter((f) => f.severity === s).length;
        return `${found.length} anomalie(s) : ${n("error")} erreur(s), ${n("warning")} avertissement(s), ${n("info")} info(s).`;
      },
    });
  },
);

registerMockScript(
  (prompt) => prompt.includes("Use the fix-test skill on the test"),
  (spawn) => {
    const id = idIn(spawn.stdin, "fix-test") ?? "";
    let changes: string[] = [];
    return mockStream(spawn, {
      delayMs: 60,
      tools: [
        { name: "Skill", input: { skill: "fix-test" } },
        { name: "mcp__testimus__tests_show", input: { id } },
        { name: "mcp__testimus__rag_passage", input: { ref: `${DOC}#§5.6.6` } },
        { name: "Edit", input: { file_path: `tests/${id}/test.md` } },
      ],
      edit: () => {
        if (testExists(spawn.cwd, id)) changes = mockFix(spawn.cwd, id);
      },
      texts: ["J'ai appliqué la note du relecteur et les anomalies du contrôle. "],
      get result() {
        return changes.length
          ? `Modifié — ${changes.join(" ; ")}.`
          : "Rien à modifier : la note et les anomalies ne demandent aucun changement.";
      },
    });
  },
);
