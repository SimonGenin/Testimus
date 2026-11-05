import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readXray } from "../lib/project.ts";
import { findingCounts, isGenerating, readCheck, readRemote, syncState, testsDir } from "../lib/store.ts";
import { parseTest, sameTestMd } from "../lib/testfile.ts";
import { awaitsReview, type FindingCounts, type SyncState, type Test } from "../types.ts";
import { type Corpus, corpus, type Doc, type Field, field, imageless } from "./match.ts";
import { type Filters, plainName } from "./query.ts";

export type TestDoc = Doc & {
  id: string;
  test: Test;
  sync: SyncState;
  dirty: boolean;
  findings?: FindingCounts;
  mtime: number;
};

const stamp = (file: string) => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
};

const STEP_WEIGHT: Record<string, number> = { Action: 2.5, "Expected Result": 2.5, Data: 1.5 };

function testFields(id: string, t: Test): Field[] {
  const out = [
    field("key", t.key ?? id, 10),
    field("summary", t.summary, 6),
    field("labels", t.labels.join(", "), 4),
    field("covers", [...t.covers, ...t.preconditions].join(", "), 4),
    field("folder", t.folder, 3),
    field("description", imageless(t.description), 2),
  ];
  if (t.reviewNote) out.push(field("review note", t.reviewNote, 1.5));
  t.steps.forEach((s, i) => {
    for (const [name, text] of Object.entries(s.fields))
      if (imageless(text).trim()) out.push(field(name, imageless(text), STEP_WEIGHT[name] ?? 2, i + 1));
    if (s.sources.length)
      out.push(field("Sources", s.sources.map((x) => `${x.docId}#${x.anchor} “${x.quote}”`).join("\n"), 1.5, i + 1));
  });
  return out;
}

type Cached = { key: string; doc: TestDoc };
const cache = new Map<string, Map<string, Cached>>();
const corpora = new Map<string, { key: string; corpus: Corpus<TestDoc> }>();

function load(project: string, id: string, names: string[], known: Map<string, Cached>): TestDoc | null {
  const dir = join(testsDir(project), id);
  const md = join(dir, "test.md");
  const key = [stamp(md), stamp(join(dir, ".remote.md")), stamp(join(dir, "check.json")), names.join("|")].join(":");
  const hit = known.get(id);
  if (hit?.key === key) return hit.doc;
  if (!existsSync(md)) return null;
  const text = readFileSync(md, "utf8");
  const { test } = parseTest(text, names);
  const remote = readRemote(project, id);
  const findings = findingCounts(readCheck(project, id), text);
  const doc: TestDoc = {
    id,
    test,
    fields: testFields(id, test),
    sync: syncState(project, id, text, remote),
    dirty: remote === null || !sameTestMd(text, remote),
    ...(findings ? { findings } : {}),
    mtime: stamp(md),
  };
  known.set(id, { key, doc });
  return doc;
}

// ponytail: each test is read again only when its test.md, its .remote.md or its check.json moved; the vocabulary
// is rebuilt when any did
export function testsCorpus(project: string): Corpus<TestDoc> {
  const root = testsDir(project);
  if (!existsSync(root)) return { docs: [], vocab: new Map() };
  const known = cache.get(project) ?? new Map<string, Cached>();
  cache.set(project, known);
  const names = readXray(project).fields.map((f) => f.name);
  const ids = readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(e.name))
    .map((e) => e.name)
    .filter((id) => !isGenerating(project, id))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  const docs = ids.map((id) => load(project, id, names, known)).filter((d): d is TestDoc => !!d);
  for (const id of [...known.keys()]) if (!ids.includes(id)) known.delete(id);
  const key = docs.map((d) => `${d.id}@${known.get(d.id)?.key}`).join("\n");
  const hit = corpora.get(project);
  if (hit?.key === key) return hit.corpus;
  const c = corpus(docs);
  corpora.set(project, { key, corpus: c });
  return c;
}

const under = (folder: string, f: string) => {
  const a = folder.toLowerCase();
  return a === f || a.startsWith(`${f.replace(/\/$/, "")}/`) || a.split("/").some((p) => p.startsWith(f.slice(1)));
};

// ponytail: « me » is the account id given (null: not known yet — then nobody is « me »)
const assignedTo = (t: Test, who: string, me: string | null) =>
  who === "me"
    ? !!me && t.assigneeId === me
    : who === "none"
      ? !t.assignee
      : !!t.assignee && plainName(t.assignee).includes(who);

export function keepTest(d: TestDoc, f: Filters, me: string | null = null): boolean {
  const t = d.test;
  if (f.assignee?.length && !f.assignee.some((w) => assignedTo(t, w, me))) return false;
  const generated = !!t.generatedBy;
  if (f.review?.length && !f.review.includes(t.review)) return false;
  if (f.sync?.length && !f.sync.includes(d.sync)) return false;
  if (f.label?.length && !f.label.every((l) => t.labels.some((x) => x.toLowerCase().includes(l)))) return false;
  if (f.folder?.length && !f.folder.some((x) => under(t.folder || "/", x))) return false;
  for (const h of f.has ?? []) {
    if (h === "findings" && !(d.findings && d.findings.errors + d.findings.warnings + d.findings.infos > 0))
      return false;
    if (h === "sources" && !t.steps.some((s) => s.sources.length)) return false;
    if (h === "key" && !t.key) return false;
    if (h === "images" && !t.steps.some((s) => s.images.length)) return false;
    if (h === "note" && !t.reviewNote) return false;
  }
  for (const i of f.is ?? []) {
    if (i === "generated" && !generated) return false;
    if (i === "awaiting" && !awaitsReview({ review: t.review, generated })) return false;
    if (i === "dirty" && !d.dirty) return false;
  }
  return true;
}
