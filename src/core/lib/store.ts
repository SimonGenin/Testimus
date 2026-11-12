import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import type {
  CheckFile,
  ColumnMode,
  ColumnModes,
  FindingCounts,
  LocalTestRef,
  StepImage,
  SyncState,
  Test,
  TestLocal,
  TestState,
} from "../types.ts";
import { copyDirAtomic, fileMtime, writeAtomic } from "./atomic.ts";
import { fileMemo } from "./file-memo.ts";
import { sha256 } from "./hash.ts";
import { natural } from "./natural.ts";
import { readJson, readXray, writeJson } from "./project.ts";
import { mapRefs, outsideTest } from "./test-blocks.ts";
import { parseTest, sameTestMd, serializeTest, testMdHash } from "./testfile.ts";

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

export const hex8 = () => randomBytes(4).toString("hex");
export const newLocalId = () => `local-${hex8()}`;

// ponytail: an id is a folder name under tests/ and nothing else — it never climbs out of the project
export function testDir(project: string, id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes(".."))
    throw new UserError(`"${id}" is not a test id.`, "Use a Jira key (LFRPS12-1420) or a local id (local-3f9a12c0).");
  return join(project, "tests", id);
}

export const testsDir = (project: string) => join(project, "tests");

// ponytail: an id that is no folder name is a test that does not exist — only writing refuses it (testDir)
export const testExists = (project: string, id: string) =>
  /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes("..") && existsSync(join(project, "tests", id, "test.md"));

// ponytail: a running generation's tests are not there for anyone until it ends — not in the tests, the review,
// the search or a count. It holds every local test that appears after it started, except one made in this
// process meanwhile (by hand, a copy); Claude writes from its own processes, so its tests are never let through
const holds = new Map<string, Set<string>[]>();

export function holdNewTests(project: string): () => void {
  const key = resolve(project);
  const dir = testsDir(project);
  const known = new Set(existsSync(dir) ? readdirSync(dir) : []);
  holds.set(key, [...(holds.get(key) ?? []), known]);
  return () => {
    const left = (holds.get(key) ?? []).filter((k) => k !== known);
    if (left.length) holds.set(key, left);
    else holds.delete(key);
  };
}

export const isGenerating = (project: string, id: string) =>
  /^local-[0-9a-f]{8}$/i.test(id) && !!holds.get(resolve(project))?.some((known) => !known.has(id));

export function readCheck(project: string, id: string): CheckFile | null {
  const raw = read(join(testDir(project, id), "check.json"));
  if (raw === null) return null;
  try {
    return JSON.parse(raw.replace(/^﻿/, "")) as CheckFile;
  } catch {
    return null;
  }
}

export function findingCounts(check: CheckFile | null, md: string): FindingCounts | undefined {
  if (!check) return undefined;
  const n = (s: string) => (check.findings ?? []).filter((f) => f.severity === s).length;
  return { errors: n("error"), warnings: n("warning"), infos: n("info"), stale: testMdHash(md) !== check.testHash };
}

export const readRemote = (project: string, id: string) => read(join(testDir(project, id), ".remote.md"));

const MODES = new Set(["open", "filled", "collapsed"]);
const localFile = (project: string, id: string) => join(testDir(project, id), "local.json");

// ponytail: a test's own settings beside test.md — its contexts (the whole list, [] = none) and how its columns
// fold; absent keys follow the project, and a file left with nothing is removed
export function readLocal(project: string, id: string): TestLocal {
  const raw = readJson<Record<string, unknown>>(localFile(project, id), {});
  const out: TestLocal = {};
  if (Array.isArray(raw.contexts))
    out.contexts = raw.contexts.filter((x): x is string => typeof x === "string" && /^[\w-]+$/.test(x));
  if (raw.columns && typeof raw.columns === "object") {
    const columns: ColumnModes = {};
    for (const [k, v] of Object.entries(raw.columns as Record<string, unknown>))
      if (typeof v === "string" && MODES.has(v)) columns[k] = v as ColumnMode;
    if (Object.keys(columns).length) out.columns = columns;
  }
  return out;
}

export function writeLocal(project: string, id: string, local: TestLocal): void {
  const next: TestLocal = {
    ...(local.contexts ? { contexts: [...new Set(local.contexts)] } : {}),
    ...(local.columns && Object.keys(local.columns).length ? { columns: local.columns } : {}),
  };
  if (Object.keys(next).length) writeJson(localFile(project, id), next);
  else rmSync(localFile(project, id), { force: true });
}

const stateFile = (project: string, id: string) => join(testDir(project, id), ".state.json");

// ponytail: tests/<id>/.state.json — what the app derived about a test, never edited: when Jira was seen changed
// since .remote.md, and the print of the content a generation wrote; an empty state leaves no file
export function readState(project: string, id: string): TestState {
  const raw = readJson<Record<string, unknown>>(stateFile(project, id), {});
  return {
    ...(typeof raw.remoteChangedAt === "string" ? { remoteChangedAt: raw.remoteChangedAt } : {}),
    ...(typeof raw.generatedPrint === "string" ? { generatedPrint: raw.generatedPrint } : {}),
  };
}

function patchState(project: string, id: string, patch: Partial<Record<keyof TestState, string | undefined>>): void {
  const next: Record<string, string | undefined> = { ...readState(project, id), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  if (Object.keys(next).length) writeJson(stateFile(project, id), next);
  else rmSync(stateFile(project, id), { force: true });
}

// ponytail: Xray Editor only knew a remote change live, by pulling; listing hundreds of tests cannot, so
// whoever pulls the remote and sees it moved leaves this mark and the next pull or push clears it
export function markRemoteChanged(project: string, id: string, changed: boolean): void {
  patchState(project, id, { remoteChangedAt: changed ? env.now().toISOString() : undefined });
}

export const isRemoteChanged = (project: string, id: string) => !!readState(project, id).remoteChangedAt;

export function writeRemote(project: string, id: string, md: string): void {
  writeAtomic(join(testDir(project, id), ".remote.md"), md);
  markRemoteChanged(project, id, false);
}

// ponytail: what a person can change in a test, and only that — the review keys, the key, the folder, the
// labels (the review label comes back with a pull) and the attachment names all move without anyone editing it
export const contentPrint = (t: Test) =>
  sha256(
    JSON.stringify([
      t.summary.trim(),
      t.description.trim(),
      [...t.covers].sort(),
      [...t.preconditions].sort(),
      t.steps.map((s) => [
        Object.entries(s.fields)
          .map(([k, v]) => [k, mapRefs(v, () => "![]()").trim()])
          .filter(([, v]) => v !== "")
          .sort(([a], [b]) => a.localeCompare(b)),
        s.sources.map((x) => `${x.docId}#${x.anchor} ${x.quote}`),
        s.images.length,
      ]),
    ]),
  );

export function markGenerated(project: string, id: string): void {
  const md = read(join(testDir(project, id), "test.md"));
  if (md !== null) patchState(project, id, { generatedPrint: contentPrint(parseTest(md).test) });
}

function isEdited(project: string, id: string, test: Test): boolean {
  const print = test.generatedBy ? readState(project, id).generatedPrint : undefined;
  return !!print && print !== contentPrint(test);
}

export function syncState(project: string, id: string, md: string, remoteMd: string | null): SyncState {
  if (remoteMd === null) return "local";
  if (isRemoteChanged(project, id)) return "remote-changed";
  return sameTestMd(md, remoteMd) ? "synced" : "modified";
}

// ponytail: a test's row is read again only when one of the files it is made of moved — listing hundreds of tests
// (the list, the review queue, the counts, each change Claude makes) only stats them
const TEST_FILES = ["test.md", ".remote.md", "check.json", ".state.json"];
const refs = fileMemo<Omit<LocalTestRef, "generating"> | null>();

export function localTestRef(project: string, id: string): LocalTestRef | null {
  const dir = testDir(project, id);
  const ref = refs(
    dir,
    TEST_FILES.map((f) => join(dir, f)),
    () => readRef(project, id),
  );
  if (!ref) return null;
  return { ...ref, ...(isGenerating(project, id) ? { generating: true } : {}) };
}

function readRef(project: string, id: string): Omit<LocalTestRef, "generating"> | null {
  const dir = testDir(project, id);
  const md = read(join(dir, "test.md"));
  if (md === null) return null;
  const { test } = parseTest(md);
  const remote = readRemote(project, id);
  const findings = findingCounts(readCheck(project, id), md);
  return {
    id,
    key: test.key,
    summary: test.summary,
    folder: test.folder,
    labels: test.labels,
    ...(test.status ? { status: test.status } : {}),
    ...(test.assignee ? { assignee: test.assignee } : {}),
    ...(test.assigneeId ? { assigneeId: test.assigneeId } : {}),
    review: test.review,
    generated: !!test.generatedBy,
    edited: isEdited(project, id, test),
    sync: syncState(project, id, md, remote),
    synced: remote !== null,
    dirty: remote === null || !sameTestMd(md, remote),
    mtime: fileMtime(join(dir, "test.md")),
    stepCount: test.steps.length,
    ...(findings ? { findings } : {}),
  };
}

// ponytail: a folder holds the tests filed in it and below it; "" or "/" is the whole repository
export function inFolder(folder: string, under: string): boolean {
  const base = under.replace(/\/+$/, "");
  return base === "" || folder === base || folder.startsWith(`${base}/`);
}

export function listLocalTests(project: string, o: { generating?: boolean } = {}): LocalTestRef[] {
  const dir = testsDir(project);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(e.name))
    .filter((e) => o.generating || !isGenerating(project, e.name))
    .map((e) => localTestRef(project, e.name))
    .filter((r): r is LocalTestRef => r !== null)
    .sort((a, b) => natural(a.id, b.id));
}

export function readTest(
  project: string,
  id: string,
): { test: Test; warnings: string[]; md: string; remoteMd?: string } {
  const md = read(join(testDir(project, id), "test.md"));
  if (md === null)
    throw new UserError(`No test ${id} in this project.`, "testimus tests list shows the tests.", "test-gone");
  const { test, warnings } = parseTest(
    md,
    readXray(project).fields.map((f) => f.name),
  );
  const remoteMd = readRemote(project, id);
  return { test, warnings, md, ...(remoteMd === null ? {} : { remoteMd }) };
}

export function writeTest(project: string, id: string, test: Test, fieldOrder: readonly string[] = []): string {
  const outside = outsideTest(test);
  if (outside.length)
    throw new UserError(
      `${outside[0]}: the test was not written.`,
      "Pictures live in images/ inside the test folder — attach them with tests.addImage.",
    );
  const md = serializeTest(test, fieldOrder);
  writeAtomic(join(testDir(project, id), "test.md"), md);
  return md;
}

export function createLocalTest(project: string, test: Test, fieldOrder: readonly string[] = []): string {
  let id = newLocalId();
  while (existsSync(testDir(project, id))) id = newLocalId();
  for (const known of holds.get(resolve(project)) ?? []) known.add(id);
  writeTest(project, id, test, fieldOrder);
  return id;
}

export async function cloneLocalTest(
  project: string,
  fromId: string,
  fieldOrder: readonly string[] = [],
): Promise<string> {
  const { test } = readTest(project, fromId);
  const from = testDir(project, fromId);
  const id = createLocalTest(
    project,
    {
      ...test,
      key: undefined,
      status: undefined,
      assignee: undefined,
      assigneeId: undefined,
      clonedFrom: test.key ?? test.clonedFrom,
      summary: `${test.summary} (copy)`,
      review: "draft",
      generatedBy: undefined,
      reviewNote: undefined,
      reviewedBy: undefined,
      reviewedAt: undefined,
      steps: test.steps.map((s) => ({
        fields: { ...s.fields },
        sources: s.sources.map((x) => ({ ...x })),
        images: s.images.map((im) => ({ file: im.file, ...(im.figure && { figure: im.figure }) })),
      })),
    },
    fieldOrder,
  );
  if (existsSync(join(from, "images"))) await copyDirAtomic(join(from, "images"), join(testDir(project, id), "images"));
  return id;
}

export function removeTest(project: string, id: string): void {
  rmSync(testDir(project, id), { recursive: true, force: true });
}

export function renameTestFolder(project: string, oldId: string, newId: string): void {
  const to = testDir(project, newId);
  if (existsSync(to)) throw new UserError(`tests/${newId} already exists.`, `Remove or rename tests/${newId} first.`);
  renameSync(testDir(project, oldId), to);
}

export function addImage(project: string, id: string, bytes: Uint8Array, ext: string): StepImage {
  const file = `images/img-${hex8()}.${ext.replace(/^[.]/, "").toLowerCase() || "png"}`;
  writeAtomic(join(testDir(project, id), file), bytes);
  return { file };
}

export function removeImageFile(project: string, id: string, file: string): void {
  if (!/^images\/[^\\/]+$/.test(file) || file.includes("..")) throw new UserError(`"${file}" is not a test image.`);
  rmSync(join(testDir(project, id), file), { force: true });
}
