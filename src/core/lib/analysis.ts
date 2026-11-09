import { join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import type { Source, Step, Test } from "../types.ts";
import { type Corpus, flat, loadCorpus, mechanicalFindings } from "./check.ts";
import { fieldOrder, stepColumns } from "./columns.ts";
import { readJson, readXray, writeJson } from "./project.ts";
import { osUser } from "./review.ts";
import { readTest, testDir, writeTest } from "./store.ts";
import { toSources } from "./test-edit.ts";
import { fieldName, formatSource, parseSource, testMdHash } from "./testfile.ts";

// ponytail: Claude reads a test against the documents and proposes; the core proves every source before keeping a
// proposal, keeps what the team entered in a column Claude must not rewrite, and writes test.md only when a person
// accepts one. tests/<id>/analysis.json is managed by this module alone

export type ColumnRole = "keep" | "open" | "leave";
export const COLUMN_ROLES: [ColumnRole, ...ColumnRole[]] = ["keep", "open", "leave"];
export type ProposalKind = "source" | "change" | "step" | "remove";
export const PROPOSAL_KINDS: [ProposalKind, ...ProposalKind[]] = ["source", "change", "step", "remove"];
export type ProposalState = "open" | "accepted" | "rejected";

export type Proposal = {
  id: string;
  kind: ProposalKind;
  title: string;
  why: string;
  step?: number;
  after?: number;
  column?: string;
  before?: string;
  value?: string;
  fields?: Record<string, string>;
  sources: string[];
  state: ProposalState;
  decidedBy?: string;
  decidedAt?: string;
};

export type ColumnReading = { name: string; role: ColumnRole; why: string };
export type Unfound = { step: number; column: string; item: string; why?: string };
export type BaseStep = { id?: string; print: string; gone?: boolean };

export type AnalysisFile = {
  at: string;
  testHash: string;
  summary: string;
  columns: ColumnReading[];
  unfound: Unfound[];
  steps: BaseStep[];
  proposals: Proposal[];
  run?: { runId: string; model: string; effort: string; note?: string };
};

export type ProposalIn = {
  kind: ProposalKind;
  title: string;
  why: string;
  step?: number;
  after?: number;
  column?: string;
  value?: string;
  fields?: Record<string, string>;
  sources?: string[];
};

export type RecordIn = {
  summary: string;
  columns: ColumnReading[];
  unfound: Unfound[];
  proposals: ProposalIn[];
};

// what analysis.show adds: where each proposal lands in the test as it is now, or why it no longer applies
export type ProposalView = Proposal & { cites: Source[]; now?: number; stale?: string; drops?: Dropped[] };
export type Dropped = { column: string; item: string };
export type AnalysisView = Omit<AnalysisFile, "proposals"> & { proposals: ProposalView[]; changed: boolean };

const fileOf = (project: string, id: string) => join(testDir(project, id), "analysis.json");

export function readAnalysis(project: string, id: string): AnalysisFile | null {
  return readJson<AnalysisFile | null>(fileOf(project, id), null);
}

const writeAnalysis = (project: string, id: string, a: AnalysisFile) => writeJson(fileOf(project, id), a);

const printOf = (s: Step) =>
  JSON.stringify(
    Object.entries(s.fields)
      .map(([k, v]) => [k, flat(v)])
      .filter(([, v]) => v)
      .sort(([a], [b]) => a.localeCompare(b)),
  );

const baseOf = (t: Test): BaseStep[] => t.steps.map((s) => ({ ...(s.id ? { id: s.id } : {}), print: printOf(s) }));

// ponytail: a cell's items — a requirement code, a value — as the team separates them
export const itemsOf = (cell: string) =>
  cell
    .split(/[,;\n]/)
    .map((x) => flat(x))
    .filter(Boolean);

// ponytail: a step of the analysed test, in the test as it is now: by its Xray id, else by its fields as Claude read
// them (the nearest when several match); -1 when it was removed or changed since
export function locate(test: Test, base: BaseStep[], n: number): number {
  const b = base[n - 1];
  if (!b || b.gone) return -1;
  if (b.id) return test.steps.findIndex((s) => s.id === b.id);
  const hits = test.steps.flatMap((s, i) => (printOf(s) === b.print ? [i] : []));
  if (!hits.length) return -1;
  return hits.reduce((best, i) => (Math.abs(i - (n - 1)) < Math.abs(best - (n - 1)) ? i : best));
}

const cellOf = (s: Step, column: string) =>
  Object.entries(s.fields).find(([k]) => k.toLowerCase() === column.toLowerCase())?.[1] ?? "";

// ponytail: what the core holds whatever Claude says — a Reference source column is the team's; a column nothing
// describes is the team's where the test already holds text in it, else it stays empty
export function rolesOf(project: string, test: Test, columns: ColumnReading[] = []): Map<string, ColumnRole> {
  const roles = new Map<string, ColumnRole>();
  for (const c of stepColumns(project)) {
    const held = test.steps.some((s) => cellOf(s, c.name).trim());
    if (c.referenceSource || (c.description === "" && held)) roles.set(c.name.toLowerCase(), "keep");
    else if (c.description === "") roles.set(c.name.toLowerCase(), "leave");
  }
  for (const c of columns) {
    const k = c.name.toLowerCase();
    const forced = roles.get(k);
    if (forced === "keep" || forced === "leave") continue;
    roles.set(k, c.role);
  }
  return roles;
}

// ponytail: the columns as the panel lists them: Claude's reading, and the ones the core holds whatever Claude says
function readingOf(project: string, test: Test, columns: ColumnReading[]): ColumnReading[] {
  const roles = rolesOf(project, test, columns);
  const said = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
  return stepColumns(project).flatMap((c) => {
    const role = roles.get(c.name.toLowerCase());
    const why = said.get(c.name.toLowerCase())?.why ?? "";
    const held = test.steps.some((s) => cellOf(s, c.name).trim());
    if (!role || (!held && !said.has(c.name.toLowerCase()))) return [];
    if (why) return [{ name: c.name, role, why }];
    if (c.referenceSource) return [{ name: c.name, role, why: "A Reference source column: its items stay." }];
    if (role === "keep")
      return [{ name: c.name, role, why: "No description says what it holds: what the team wrote stays." }];
    return [{ name: c.name, role, why }];
  });
}

function sourceErrors(where: string, step: Step, corpus: Corpus, linked: string[]): string[] {
  const probe: Test = {
    project: "",
    summary: "",
    folder: "",
    labels: [],
    description: "",
    covers: [],
    preconditions: [],
    review: "draft",
    steps: [{ ...step, images: [] }],
    extra: {},
  };
  return mechanicalFindings(probe, corpus, linked)
    .filter(
      (f) =>
        (f.severity === "error" && ["source-missing", "quote-not-found", "quote-not-at-anchor"].includes(f.kind)) ||
        f.kind === "quote-weak" ||
        f.kind === "item-not-found",
    )
    .map((f) => `${where}: ${f.message.replace(/^Step 1:? ?/, "")}`);
}

const parseLines = (where: string, lines: string[], errors: string[]): Source[] => {
  try {
    return toSources(lines);
  } catch (e) {
    errors.push(`${where}: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
};

// ponytail: what Claude sends, checked as a whole — every mistake is listed at once, so Claude fixes them in one go
// and calls again; nothing is written until every proposal holds
export function recordAnalysis(project: string, id: string, input: RecordIn): AnalysisFile {
  const { test, md } = readTest(project, id);
  const corpus = loadCorpus(project);
  const known = readXray(project).fields.map((f) => f.name);
  const columns = stepColumns(project);
  const names = new Map(columns.map((c) => [c.name.toLowerCase(), c.name]));
  const linked = columns.filter((c) => c.referenceSource).map((c) => c.name);
  const roles = rolesOf(project, test, input.columns);
  const errors: string[] = [];
  const steps = test.steps.length;
  const proposals: Proposal[] = input.proposals.map((p, i) => {
    const where = `proposal ${i + 1} (${p.kind}${p.step ? `, step ${p.step}` : ""})`;
    const sources = (p.sources ?? []).map((s) => s.trim()).filter(Boolean);
    const out: Proposal = { id: `p${i + 1}`, kind: p.kind, title: p.title, why: p.why, sources, state: "open" };
    const parsed = parseLines(where, sources, errors);
    if (p.kind === "step") {
      const after = p.after ?? steps;
      if (after < 0 || after > steps) errors.push(`${where}: after must be 0…${steps} (0 = before step 1).`);
      const fields = Object.fromEntries(
        Object.entries(p.fields ?? {})
          .map(([k, v]) => [fieldName(names.get(k.toLowerCase()) ?? k, known), v] as const)
          .filter(([, v]) => v.trim()),
      );
      if (!(fields.Action ?? "").trim() || !(fields["Expected Result"] ?? "").trim())
        errors.push(`${where}: a new step needs an Action and an Expected Result.`);
      for (const k of Object.keys(fields)) {
        if (!names.has(k.toLowerCase())) errors.push(`${where}: ${k} is not a column of this project (columns_list).`);
        else if (roles.get(k.toLowerCase()) === "leave") errors.push(`${where}: ${k} stays empty — leave it out.`);
      }
      if (!parsed.some((s) => !s.column)) errors.push(`${where}: a new step needs a source for its expected result.`);
      errors.push(...sourceErrors(where, { fields, sources: parsed, images: [] }, corpus, linked));
      return { ...out, after, fields };
    }
    if (!p.step || p.step < 1 || p.step > steps) {
      errors.push(`${where}: step must be 1…${steps}, as tests_show numbers them.`);
      return out;
    }
    const s = test.steps[p.step - 1];
    if (p.kind === "remove") return { ...out, step: p.step };
    if (p.kind === "source") {
      if (!parsed.length) errors.push(`${where}: give the source line(s) to add.`);
      else if (parsed.every((x) => s.sources.some((y) => same(x, y))))
        errors.push(`${where}: the step already has this source.`);
      errors.push(...sourceErrors(where, { ...s, sources: parsed }, corpus, linked));
      return { ...out, step: p.step };
    }
    const column = names.get((p.column ?? "").toLowerCase());
    if (!column) {
      errors.push(`${where}: column ${JSON.stringify(p.column ?? "")} is not a column of this project (columns_list).`);
      return out;
    }
    const name = fieldName(column, known);
    const before = cellOf(s, name);
    const value = p.value ?? "";
    const role = roles.get(column.toLowerCase()) ?? "open";
    if (flat(value) === flat(before)) errors.push(`${where}: the value is the cell as it is — nothing to change.`);
    if (role === "leave" && value.trim()) errors.push(`${where}: ${column} stays empty — no change to it.`);
    if (role === "keep") {
      const lost = itemsOf(before).filter((x) => !flat(value).includes(x));
      if (lost.length)
        errors.push(
          `${where}: ${column} is kept as written — ${lost.map((x) => JSON.stringify(x)).join(", ")} must stay word for word; only add to it.`,
        );
    }
    errors.push(
      ...sourceErrors(where, { ...s, fields: { ...s.fields, [name]: value }, sources: parsed }, corpus, linked),
    );
    return { ...out, step: p.step, column: name, before, value };
  });
  for (const u of input.unfound)
    if (u.step < 1 || u.step > steps) errors.push(`unfound ${JSON.stringify(u.item)}: step must be 1…${steps}.`);
  if (errors.length)
    throw new UserError(
      `Nothing was recorded — ${errors.length} problem${errors.length === 1 ? "" : "s"}:\n${errors.map((e) => `- ${e}`).join("\n")}`,
      "Fix each one (copy quotes from doc.md at their anchor, keep a column kept as written word for word) and call analysis_record again with every proposal.",
    );
  const file: AnalysisFile = {
    at: env.now().toISOString(),
    testHash: testMdHash(md),
    summary: input.summary.trim(),
    columns: readingOf(project, test, input.columns),
    unfound: input.unfound,
    steps: baseOf(test),
    proposals,
  };
  writeAnalysis(project, id, file);
  return file;
}

export function stampRun(project: string, id: string, run: NonNullable<AnalysisFile["run"]>): void {
  const a = readAnalysis(project, id);
  if (a) writeAnalysis(project, id, { ...a, run });
}

const same = (a: Source, b: Source) => formatSource(a) === formatSource(b);
const withSources = (s: Step, add: Source[]) => [
  ...s.sources,
  ...add.filter((x) => !s.sources.some((y) => same(x, y))),
];

// ponytail: why a proposal can no longer be applied to the test as it is now, or null; its step's place when it can
function placeOf(test: Test, a: AnalysisFile, p: Proposal): { at: number } | { stale: string } {
  if (p.kind === "step") {
    if (!p.after) return { at: 0 };
    const i = locate(test, a.steps, p.after);
    return i < 0 ? { stale: `Step ${p.after} changed since the analysis.` } : { at: i + 1 };
  }
  const i = locate(test, a.steps, p.step ?? 0);
  if (i < 0)
    return {
      stale: a.steps[(p.step ?? 0) - 1]?.gone
        ? `Step ${p.step} was removed.`
        : `Step ${p.step} changed since the analysis.`,
    };
  if (p.kind === "change" && p.column && flat(cellOf(test.steps[i], p.column)) !== flat(p.before ?? ""))
    return { stale: `${p.column} of step ${p.step} changed since the analysis.` };
  return { at: i };
}

export function viewOf(project: string, id: string, a: AnalysisFile): AnalysisView {
  const { test, md } = readTest(project, id);
  const kept = [...rolesOf(project, test, a.columns)].flatMap(([k, r]) => (r === "keep" ? [k] : []));
  // ponytail: a step taken out takes the team's items with it — said on the proposal, never silently
  const dropsOf = (s: Step): Dropped[] =>
    Object.entries(s.fields).flatMap(([column, v]) =>
      kept.includes(column.toLowerCase()) ? itemsOf(v).map((item) => ({ column, item })) : [],
    );
  return {
    ...a,
    changed: testMdHash(md) !== a.testHash,
    proposals: a.proposals.map((p) => {
      const cites = p.sources.flatMap((l) => {
        const s = parseSource(l);
        return s ? [s] : [];
      });
      if (p.state !== "open") return { ...p, cites };
      const at = placeOf(test, a, p);
      if ("stale" in at) return { ...p, cites, stale: at.stale };
      const drops = p.kind === "remove" ? dropsOf(test.steps[at.at]) : [];
      return { ...p, cites, now: p.kind === "step" ? at.at : at.at + 1, ...(drops.length ? { drops } : {}) };
    }),
  };
}

function apply(test: Test, a: AnalysisFile, p: Proposal): void {
  const at = placeOf(test, a, p);
  if ("stale" in at)
    throw new UserError(at.stale, "Analyze the test again to get proposals for it as it is now.", "stale");
  const sources = toSources(p.sources);
  if (p.kind === "step") {
    test.steps.splice(at.at, 0, { fields: { ...(p.fields ?? {}) }, sources, images: [] });
    return;
  }
  const n = (p.step ?? 0) - 1;
  const s = test.steps[at.at];
  if (p.kind === "remove") {
    test.steps.splice(at.at, 1);
    a.steps[n] = { ...a.steps[n], gone: true };
    return;
  }
  if (p.kind === "change" && p.column) s.fields[p.column] = p.value ?? "";
  s.sources = withSources(s, sources);
  a.steps[n] = { ...a.steps[n], print: printOf(s) };
}

export type Decision = "accept" | "reject" | "reopen";

// ponytail: accepting writes test.md at once, one proposal after the other in the order given; a proposal that no
// longer applies stops the whole decision before anything is written
export function decide(
  project: string,
  id: string,
  ids: string[],
  decision: Decision,
): { analysis: AnalysisView; applied: string[] } {
  const a = readAnalysis(project, id);
  if (!a) throw new UserError(`The test ${id} has no analysis.`, "Run analysis.run on it first.", "no-analysis");
  const picked = ids.map((pid) => {
    const p = a.proposals.find((x) => x.id === pid);
    if (!p) throw new UserError(`No proposal ${pid} in the analysis of ${id}.`, "analysis.show lists them.");
    return p;
  });
  const by = osUser();
  const at = env.now().toISOString();
  const applied: string[] = [];
  if (decision === "accept") {
    const { test } = readTest(project, id);
    for (const p of picked) {
      if (p.state === "accepted") continue;
      apply(test, a, p);
      Object.assign(p, { state: "accepted", decidedBy: by, decidedAt: at });
      applied.push(p.id);
    }
    if (applied.length) a.testHash = testMdHash(writeTest(project, id, test, fieldOrder(project)));
  } else
    for (const p of picked) {
      if (decision === "reopen" && p.state !== "rejected") continue;
      if (decision === "reject" && p.state === "accepted")
        throw new UserError(
          `${p.id} is already in the test.`,
          "Undo it in the editor: an accepted proposal is an ordinary edit.",
        );
      if (decision === "reject") Object.assign(p, { state: "rejected", decidedBy: by, decidedAt: at });
      else {
        p.state = "open";
        delete p.decidedBy;
        delete p.decidedAt;
      }
    }
  writeAnalysis(project, id, a);
  return { analysis: viewOf(project, id, a), applied };
}
