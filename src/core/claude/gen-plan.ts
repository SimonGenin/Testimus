import { z } from "zod";
import { normalizeRef } from "../rag/anchors.ts";
import { absent, isSection, list, PLAN_TAG, SKIP, type Skipped, text, told } from "./gen-reply.ts";
import { type Block, readBlock } from "./parts.ts";

// ponytail: the plan of a generation — what plan-tests answers (its tests, each with a theme, what it leaves out and
// the questions the user settles before anything is written), what the core says of it without a model (two tests on
// the same sections, what writing it will cost) and how it reads as text (the diff of a proposal, the chat's context)

export type PlanQuestion = { id: string; text: string; why: string; sources: string[]; answers: string[] };
export type PlannedTest = {
  summary: string;
  technique: string;
  sections: string[];
  /** a few words the test is filed under: the sub-folder it is written to */
  theme?: string;
  /** unticked on Generate: not written */
  off?: boolean;
};
export type TestPlan = {
  found: boolean;
  tests: PlannedTest[];
  skipped: Skipped[];
  questions: PlanQuestion[];
  errors?: string[];
};
/** a question of the plan the user answered: every run of the writing holds to it */
export type Settled = { id: string; text: string; answer: string };

// ponytail: built on first use — gen-reply, whose pieces it is made of, reaches this module back through the ledger
let schema: ReturnType<typeof planSchema> | undefined;
function planSchema() {
  const strings = z.array(z.string().trim().min(1));
  const question = z.object({
    id: z.string().trim().min(1).max(40).describe("A short id of your own: q1, q2…"),
    text: z.string().trim().min(10).describe("The question, as the user will read it"),
    why: z
      .string()
      .trim()
      .min(10)
      .describe("Why it must be settled before writing: what is ambiguous, which passages disagree"),
    sources: absent(strings.min(1)).describe('The passages that raise it: docId#anchor "quote"'),
    answers: list().describe("2 or 3 answers to propose, the likeliest first"),
  });

  return z.object({
    tests: z
      .array(
        z.object({
          summary: z
            .string()
            .trim()
            .min(3)
            .describe("The test's summary, as it will appear in Xray, without its theme"),
          technique: text().describe("The test technique, in a few words"),
          sections: list().describe("The docId#§x.y the test is written from"),
          theme: text().describe("The theme it is filed under, in a few words (Traction, Itinéraires)"),
        }),
      )
      .min(1)
      .describe("The planned tests"),
    skipped: absent(z.array(SKIP).default([])).describe("Every behavior of the scope no planned test verifies"),
    questions: absent(z.array(question).default([])).describe(
      "What the user must settle before the tests are written: an ambiguity, documents that disagree, an uncertain scope",
    ),
  });
}

export const PLAN = () => {
  schema ??= planSchema();
  return schema;
};

// ponytail: a theme is a folder name — no slash, a few words
export const cleanTheme = (t: string | undefined): string =>
  (t ?? "")
    .replace(/[\\/]+/g, " - ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

// ponytail: « Traction — Coupure de la caténaire » under the theme Traction is « Coupure de la caténaire »
export function withoutTheme(summary: string, theme: string): string {
  if (!theme || !summary.toLowerCase().startsWith(theme.toLowerCase())) return summary;
  const after = summary.slice(theme.length);
  const rest = after.replace(/^\s*[—–:-]\s*/, "");
  return rest !== after && rest.length >= 3 ? rest : summary;
}

/** the folder a planned test is written to: its theme under the folder asked, or at the root without one */
export function themeFolder(folder: string | undefined, theme: string): string {
  const base = (folder ?? "").trim().replace(/[\\/]+$/, "");
  return `${base && !base.startsWith("/") ? `/${base}` : base}/${cleanTheme(theme)}`.replace(/\/{2,}/g, "/");
}

const uniqueIds = (qs: PlanQuestion[]): PlanQuestion[] => {
  const seen = new Set<string>();
  return qs.map((q, k) => {
    const id = seen.has(q.id) ? `${q.id}-${k + 1}` : q.id;
    seen.add(id);
    return { ...q, id };
  });
};

const none = <T>(b: Block<T>) => ({ found: false as const, errors: b.errors });

// ponytail: a planned test keeps only the sections written docId#anchor, and its summary loses the theme it repeats
export function parsePlan(reply: string): TestPlan {
  const b = readBlock(reply, PLAN_TAG, PLAN());
  if (!b.value) return { ...none(b), tests: [], skipped: [], questions: [] };
  return {
    found: true,
    tests: b.value.tests.map((t) => {
      const theme = cleanTheme(t.theme);
      return {
        summary: withoutTheme(t.summary, theme),
        technique: t.technique,
        sections: t.sections.filter(isSection),
        ...(theme ? { theme } : {}),
      };
    }),
    skipped: b.value.skipped.map(told),
    questions: uniqueIds(b.value.questions.map((q) => ({ ...q, answers: q.answers.slice(0, 4) }))),
  };
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const strs = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

// ponytail: a plan as a ledger or a page gives it — a ledger older than themes and questions still reads
export function asPlan(v: unknown, skipped: Skipped[] = []): TestPlan | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.tests)) return undefined;
  const tests: PlannedTest[] = [];
  for (const t of o.tests) {
    if (!t || typeof t !== "object") continue;
    const x = t as Record<string, unknown>;
    if (!str(x.summary)) continue;
    const theme = cleanTheme(str(x.theme));
    tests.push({
      summary: str(x.summary),
      technique: str(x.technique),
      sections: strs(x.sections),
      ...(theme ? { theme } : {}),
      ...(x.off === true ? { off: true } : {}),
    });
  }
  const questions: PlanQuestion[] = [];
  for (const q of Array.isArray(o.questions) ? o.questions : []) {
    if (!q || typeof q !== "object") continue;
    const x = q as Record<string, unknown>;
    if (!str(x.id) || !str(x.text)) continue;
    questions.push({
      id: str(x.id),
      text: str(x.text),
      why: str(x.why),
      sources: strs(x.sources),
      answers: strs(x.answers),
    });
  }
  return { found: o.found !== false, tests, skipped, questions };
}

const within = (a: string, b: string) => {
  const [da, sa] = a.split("#");
  const [db, sb] = b.split("#");
  if (da !== db || !sa || !sb) return false;
  return (
    sa === sb || (sa.startsWith("§") && sb.startsWith(`${sa}.`)) || (sb.startsWith("§") && sa.startsWith(`${sb}.`))
  );
};

export type Overlap = { tests: [number, number]; sections: string[] };

// ponytail: two tests of a plan that read the same sections (or one inside the other) may well write the same steps —
// said beside them, the user merges or keeps them; nothing is decided without the user
export function overlaps(tests: PlannedTest[]): Overlap[] {
  const out: Overlap[] = [];
  const refs = tests.map((t) => t.sections.map(normalizeRef));
  for (let i = 0; i < tests.length; i++)
    for (let j = i + 1; j < tests.length; j++) {
      if (tests[i].off || tests[j].off) continue;
      const shared = refs[i].filter((a) => refs[j].some((b) => within(a, b)));
      if (shared.length) out.push({ tests: [i, j], sections: [...new Set(shared)] });
    }
  return out;
}

// ponytail: about 3 min 20 per planned test (measured on 11/11: 111 tests), as many at a time as the agents setting
export const SECONDS_PER_TEST = 200;

export function writeCost(tests: number, agents: number): { runs: number; seconds: number } {
  return { runs: tests, seconds: Math.ceil(tests / Math.max(1, agents)) * SECONDS_PER_TEST };
}

// ponytail: the answers given move the plan's questions to what is settled; a question asked again keeps its last
// answer, an answer left empty settles nothing
export function settleAnswers(
  questions: PlanQuestion[],
  settled: Settled[],
  answers: Record<string, string>,
): { questions: PlanQuestion[]; settled: Settled[] } {
  const now = questions.flatMap((q) => {
    const a = answers[q.id]?.trim();
    return a ? [{ id: q.id, text: q.text, answer: a }] : [];
  });
  const gone = new Set(now.map((s) => s.text.toLowerCase()));
  return {
    questions: questions.filter((q) => !answers[q.id]?.trim()),
    settled: [...settled.filter((s) => !gone.has(s.text.toLowerCase())), ...now],
  };
}

export const settledLines = (settled: Settled[]): string[] => settled.map((s) => `- ${s.text} → ${s.answer}`);

// ponytail: the plan as a person reads it — by theme, one line per test (what it is, how, from where), then the open
// questions; the diff of a proposal and the chat's context are this text
export function planText(plan: Pick<TestPlan, "tests" | "questions">): string {
  const lines: string[] = [];
  for (const theme of [...new Set(plan.tests.map((t) => t.theme ?? ""))]) {
    lines.push(`## ${theme || "No theme"}`);
    plan.tests.forEach((t, k) => {
      if ((t.theme ?? "") !== theme) return;
      const how = [t.technique, t.sections.join(", ")].filter(Boolean).join(" · ");
      lines.push(`- ${k + 1}. ${t.summary}${how ? ` (${how})` : ""}${t.off ? " — unticked: not written" : ""}`);
    });
    lines.push("");
  }
  if (plan.questions.length) {
    lines.push("## Questions");
    for (const q of plan.questions)
      lines.push(`- ${q.id}: ${q.text}${q.answers.length ? ` (proposed: ${q.answers.join(" / ")})` : ""}`);
  }
  return lines.join("\n").trim();
}

export const REPLAN_MARKER = "The user reviewed your plan of tests before any is written";

// ponytail: « Revise the plan » — the plan's own session is resumed (it has read the documents): told what the user
// settled, the plan as they left it and what they ask; it answers the whole plan again
export function replanText(o: {
  settled: Settled[];
  plan: Pick<TestPlan, "tests" | "questions">;
  request: string;
  /** the plan's first request, when its session cannot be resumed and the run starts from nothing */
  first?: string;
}): string {
  const lines = [
    ...(o.first
      ? [o.first, "", "You planned this scope before, and the session is gone; plan it again from here."]
      : []),
    `${REPLAN_MARKER}. Revise it with the plan-tests skill: keep what they settled and what they changed.`,
  ];
  if (o.settled.length)
    lines.push("", "Answers the user gave — hold to them, never ask them again:", ...settledLines(o.settled));
  lines.push(
    "",
    "The plan as the user left it (they may have renamed, merged or moved tests to another theme — keep it so; a test marked unticked is not wanted: drop it, never report it):",
    planText({ tests: o.plan.tests, questions: [] }),
  );
  if (o.request.trim()) lines.push("", `What the user asks: ${o.request.trim()}`);
  lines.push(
    "",
    `Ask again only what is still open. End your reply with the whole plan in its ${PLAN_TAG} block — tests with their theme, skipped, questions — valid JSON, nothing after it.`,
    "",
  );
  return lines.join("\n");
}
