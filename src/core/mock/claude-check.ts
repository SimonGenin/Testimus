import { CHECK_MARKER } from "../claude/check.ts";
import { REVIEW_TAG } from "../claude/gen-review.ts";
import { invoke } from "../commands/index.ts";
import { fieldOrder } from "../lib/columns.ts";
import { readCheck, readTest, testExists, writeTest } from "../lib/store.ts";
import type { Finding, StepVerdict, Test } from "../types.ts";
import { mockStream, registerMockScript } from "./claude.ts";

const DOC = "SOSIE_211_D401-1_3";
const TK_QUOTE = "un sectionneur avec TK manœuvré régulièrement ne propose que Propriétés";
const TK_RESULT = "Le menu contextuel ne propose que Propriétés.";
const TK_FIX = `Écrire que le menu ne propose que Propriétés, comme le dit le §5.6.6 (« ${TK_QUOTE} »).`;

type Found = Omit<Finding, "pass">;

const idIn = (prompt: string, skill: string) =>
  new RegExp(`Use the ${skill} skill on the test ([A-Za-z0-9._-]+)\\.`).exec(prompt)?.[1];

// ponytail: the tests a check request names, one per line « - <id> — « summary », n steps. »
const checkedIn = (prompt: string) => [...prompt.matchAll(/^- ([A-Za-z0-9][\w.-]*) — « /gm)].map((m) => m[1]);

export function mockFindings(test: Test): Found[] {
  const out: Found[] = [];
  test.steps.forEach((s, i) => {
    const step = i + 1;
    const expected = (s.fields["Expected Result"] ?? "").trim();
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
        fix: "Lister les commandes que le §5.6.6 donne pour ce type de sectionneur.",
      });
  });
  const said = test.steps.map((s) => Object.values(s.fields).join(" ")).join(" ");
  if (/sans TK/i.test(test.summary) && !/avec TK/i.test(said))
    out.push({
      kind: "negative-missing",
      severity: "warning",
      message: "Aucun step ne vérifie qu'un sectionneur avec TK manœuvré régulièrement ne propose que Propriétés.",
      sources: [`${DOC}#§5.6.6`],
      fix: TK_FIX,
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

// ponytail: a verdict per step, as the real check gives — the passage each step cites was read; a step a finding
// disproves is unsupported, one without a source could not be judged
export function mockVerdicts(test: Test, found: Found[]): StepVerdict[] {
  return test.steps.map((s, i) => {
    const step = i + 1;
    const read = [...new Set(s.sources.filter((x) => x.anchor).map((x) => `${x.docId}#${x.anchor}`))];
    if (found.some((f) => f.step === step && f.severity === "error"))
      return { step, verdict: "unsupported", read: read.length ? read : [`${DOC}#§5.6.6`] };
    if (!read.length) return { step, verdict: "unverified", read: [], why: "Le step ne cite aucun passage." };
    return { step, verdict: "supported", read };
  });
}

function record(project: string, id: string, findings: Found[], steps: StepVerdict[]): void {
  invoke("check.record", { id, findings, steps }, { project }).catch(() => {});
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
  if (findings.some((f) => f.kind === "negative-missing")) {
    test.steps.push({
      fields: { Action: "Clic droit sur un sectionneur avec TK manœuvré régulièrement.", "Expected Result": TK_RESULT },
      sources: [{ docId: DOC, anchor: "§5.6.6", quote: TK_QUOTE }],
      images: [],
    });
    changes.push(`step ${test.steps.length} ajouté : le cas du sectionneur avec TK`);
  }
  if (changes.length) writeTest(project, id, test, fieldOrder(project));
  return changes;
}

// ponytail: what the scripted Claude says about a generation when the check request asks — every reason holds but the
// faulty TK, which §5.6.6 does speak of, and a few requests that name what these tests hold
export function mockReview(prompt: string): string {
  const items = [...prompt.matchAll(/^(\d+)\. (.+?) — /gm)].map((m) => ({ n: Number(m[1]), item: m[2] }));
  const tests = checkedIn(prompt);
  const skipped = items.map(({ n, item }) =>
    /TK pendant/i.test(item)
      ? {
          n,
          verdict: "writable",
          why: "§5.6.6 says what the menu of a sectionneur with TK offers: the test can check it while the TK is faulty.",
          sources: [`${DOC}#§5.6.6 "${TK_QUOTE}"`],
        }
      : { n, verdict: "confirmed", why: "Searched again for its terms: no passage states what the screen shows." },
  );
  const suggestions = [
    {
      label: "Add the faulty TK cases",
      prompt: "Add tests where the sectionneur's TK is faulty: what the menu and the Propriétés window show then.",
      scope: "add",
    },
    {
      label: "Check each command of the menu",
      prompt: "In each test that opens the context menu, check every command it lists against §5.6.6.",
      scope: "change",
    },
    ...(tests.length > 1
      ? [
          {
            label: `Merge the ${tests.length} menu tests`,
            prompt: "Merge the tests that open the same context menu into one test, keeping every check and source.",
            scope: "change",
          },
        ]
      : []),
  ];
  return `\n\n\`\`\`${REVIEW_TAG}\n${JSON.stringify({ ...(items.length ? { skipped } : {}), suggestions }, null, 2)}\n\`\`\``;
}

registerMockScript(
  (prompt) => prompt.startsWith(CHECK_MARKER),
  (spawn) => {
    const ids = checkedIn(spawn.stdin);
    const review = spawn.stdin.includes(`\`\`\`${REVIEW_TAG}`) ? mockReview(spawn.stdin) : "";
    const counts: string[] = [];
    return mockStream(spawn, {
      delayMs: 60,
      tools: [
        { name: "Skill", input: { skill: "check-test" } },
        ...ids.map((id) => ({ name: "mcp__testimus__tests_show", input: { id } })),
        { name: "mcp__testimus__rag_passage", input: { ref: `${DOC}#§5.6.6` } },
        ...ids.map((id) => ({ name: "mcp__testimus__check_record", input: { id } })),
      ],
      edit: () => {
        for (const id of ids) {
          if (!testExists(spawn.cwd, id)) continue;
          const { test } = readTest(spawn.cwd, id);
          const found = mockFindings(test);
          record(spawn.cwd, id, found, mockVerdicts(test, found));
          const n = (s: string) => found.filter((f) => f.severity === s).length;
          counts.push(`${id} : ${n("error")} erreur(s), ${n("warning")} avertissement(s), ${n("info")} info(s).`);
        }
      },
      texts: ["J'ai relu chaque step avec le passage cité. ", "Les verdicts et les anomalies sont enregistrés."],
      get result() {
        return `${counts.join("\n")}${review}`;
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
