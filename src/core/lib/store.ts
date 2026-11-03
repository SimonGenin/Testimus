import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import type { CheckFile, FindingCounts, LocalTestRef, StepImage, SyncState, Test } from "../types.ts";
import { copyDirAtomic, writeAtomic } from "./atomic.ts";
import { sha256 } from "./hash.ts";
import { readXray } from "./project.ts";
import { mapRefs, outsideTest, parseTest, sameTestMd, serializeTest, testMdHash } from "./testfile.ts";

const read = (path: string) => {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
};

export { writeAtomic };

export const hex8 = () => randomBytes(4).toString("hex");
export const newLocalId = () => `local-${hex8()}`;

// ponytail: an id is a folder name under tests/ and nothing else — it never climbs out of the project
export function testDir(project: string, id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || id.includes(".."))
    throw new UserError(`"${id}" is not a test id.`, "Use a Jira key (LFRPS12-1420) or a local id (local-3f9a12c0).");
  return join(project, "tests", id);
}

export const testsDir = (project: string) => join(project, "tests");

export const testExists = (project: string, id: string) => existsSync(join(testDir(project, id), "test.md"));

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

const markerOf = (project: string, id: string) => join(testDir(project, id), ".remote-changed");

// ponytail: Xray Editor only knew a remote change live, by pulling; listing hundreds of tests cannot, so
// whoever pulls the remote and sees it moved leaves this marker and the next pull or push clears it
export function markRemoteChanged(project: string, id: string, changed: boolean): void {
  const file = markerOf(project, id);
  if (changed) writeAtomic(file, `${new Date().toISOString()}\n`);
  else rmSync(file, { force: true });
}

export const isRemoteChanged = (project: string, id: string) => existsSync(markerOf(project, id));

export function writeRemote(project: string, id: string, md: string): void {
  writeAtomic(join(testDir(project, id), ".remote.md"), md);
  markRemoteChanged(project, id, false);
}

// ponytail: what a person can change in a test, and only that — the review keys, the key, the folder, the
// labels (the review label comes back with a pull) and the attachment names all move without anyone editing it
const contentPrint = (t: Test) =>
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

const printOf = (project: string, id: string) => join(testDir(project, id), ".generated");

export function markGenerated(project: string, id: string): void {
  const md = read(join(testDir(project, id), "test.md"));
  if (md !== null) writeAtomic(printOf(project, id), `${contentPrint(parseTest(md).test)}\n`);
}

function isEdited(project: string, id: string, test: Test): boolean {
  const print = test.generatedBy ? read(printOf(project, id))?.trim() : undefined;
  return !!print && print !== contentPrint(test);
}

export function syncState(project: string, id: string, md: string, remoteMd: string | null): SyncState {
  if (remoteMd === null) return "local";
  if (isRemoteChanged(project, id)) return "remote-changed";
  return sameTestMd(md, remoteMd) ? "synced" : "modified";
}

export function localTestRef(project: string, id: string): LocalTestRef | null {
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
    review: test.review,
    generated: !!test.generatedBy,
    edited: isEdited(project, id, test),
    sync: syncState(project, id, md, remote),
    synced: remote !== null,
    dirty: remote === null || !sameTestMd(md, remote),
    mtime: Math.round(statSync(join(dir, "test.md")).mtimeMs),
    stepCount: test.steps.length,
    ...(findings ? { findings } : {}),
  };
}

export function listLocalTests(project: string): LocalTestRef[] {
  const dir = testsDir(project);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(e.name))
    .map((e) => localTestRef(project, e.name))
    .filter((r): r is LocalTestRef => r !== null)
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}

export function readTest(
  project: string,
  id: string,
): { test: Test; warnings: string[]; md: string; remoteMd?: string } {
  const md = read(join(testDir(project, id), "test.md"));
  if (md === null) throw new UserError(`No test ${id} in this project.`, "testimus tests list shows the tests.");
  const { test, warnings } = parseTest(
    md,
    readXray(project).fields.map((f) => f.name),
  );
  const remoteMd = readRemote(project, id);
  return { test, warnings, md, ...(remoteMd === null ? {} : { remoteMd }) };
}

export const loadTest = readTest;

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

export const saveTest = writeTest;

export function createLocalTest(project: string, test: Test, fieldOrder: readonly string[] = []): string {
  let id = newLocalId();
  while (existsSync(testDir(project, id))) id = newLocalId();
  writeTest(project, id, test, fieldOrder);
  return id;
}

export function cloneLocalTest(project: string, fromId: string, fieldOrder: readonly string[] = []): string {
  const { test } = readTest(project, fromId);
  const from = testDir(project, fromId);
  const id = createLocalTest(
    project,
    {
      ...test,
      key: undefined,
      status: undefined,
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
        images: s.images.map((im) => ({ file: im.file })),
      })),
    },
    fieldOrder,
  );
  if (existsSync(join(from, "images"))) copyDirAtomic(join(from, "images"), join(testDir(project, id), "images"));
  return id;
}

export function removeTest(project: string, id: string): void {
  rmSync(testDir(project, id), { recursive: true, force: true });
}

export const deleteLocalTest = removeTest;

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
