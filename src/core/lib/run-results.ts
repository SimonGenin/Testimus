import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import { writeAtomic } from "./atomic.ts";
import { osUser } from "./review.ts";
import {
  type RunComment,
  type RunResult,
  type RunStatus,
  type RunTest,
  readResult,
  readRunFile,
  runDir,
  writeResult,
} from "./runs.ts";
import { hex8 } from "./store.ts";

// ponytail: what a tester records on one test of a run — the marks per step, the result, the comments and questions,
// the screenshots — each change written at once to results/<testId>.json, stamped with who and when

function testOf(project: string, slug: string, testId: string): RunTest {
  const run = readRunFile(project, slug);
  const t = run.tests.find((x) => x.id === testId || x.key === testId);
  if (!t)
    throw new UserError(`No test ${testId} in the run « ${run.name} ».`, `testimus runs show ${slug} lists its tests.`);
  return t;
}

function stepIndex(t: RunTest, step: number): number {
  if (!Number.isInteger(step) || step < 1 || step > t.steps.length)
    throw new UserError(
      `Step ${step} does not exist — the test has ${t.steps.length} step(s).`,
      `Give a step from 1 to ${t.steps.length}.`,
    );
  return step - 1;
}

function save(project: string, slug: string, t: RunTest, r: RunResult): RunResult {
  const next = { ...r, updatedAt: env.now().toISOString(), updatedBy: osUser() };
  writeResult(project, slug, t.id, next);
  return next;
}

export type ResultPatch = {
  status?: RunStatus;
  steps?: { step: number; ok: boolean | null; note?: string }[];
  blockedReason?: string | null;
};

export function setResult(project: string, slug: string, testId: string, p: ResultPatch) {
  const t = testOf(project, slug, testId);
  const r = readResult(project, slug, t);
  for (const s of p.steps ?? []) {
    const i = stepIndex(t, s.step);
    const note = s.note === undefined ? r.steps[i].note : s.note.trim();
    r.steps[i] = { ok: s.ok, ...(note ? { note } : {}) };
  }
  if (p.blockedReason !== undefined) {
    const reason = p.blockedReason?.trim();
    if (reason) r.blockedReason = reason;
    else delete r.blockedReason;
  }
  if (p.status) r.status = p.status;
  if (r.status === "blocked" && !r.blockedReason)
    throw new UserError(
      "A blocked test needs its reason.",
      'Say why, e.g. --blockedReason "TK not wired on the simulator".',
    );
  if (r.status !== "blocked") delete r.blockedReason;
  return { test: t.id, result: save(project, slug, t, r) };
}

export type CommentInput = { kind: "comment" | "question"; text: string; step?: number; answers?: string };

export function addComment(project: string, slug: string, testId: string, c: CommentInput) {
  const t = testOf(project, slug, testId);
  const r = readResult(project, slug, t);
  const text = c.text.trim();
  if (!text) throw new UserError("The comment is empty.", "Write what you saw, or what you want to ask.");
  const by = osUser();
  const at = env.now().toISOString();
  let comment: RunComment;
  if (c.answers) {
    const q = r.comments.find((x) => x.id === c.answers);
    if (!q) throw new UserError(`No comment ${c.answers} on this test.`, `testimus runs show ${slug} lists them.`);
    if (q.kind !== "question") throw new UserError("Only a question is answered.", "Add a comment instead.");
    Object.assign(q, { answer: text, answeredBy: by, answeredAt: at });
    comment = q;
  } else {
    if (c.step !== undefined) stepIndex(t, c.step);
    comment = { id: hex8(), kind: c.kind, ...(c.step !== undefined ? { step: c.step } : {}), text, by, at };
    r.comments.push(comment);
  }
  return { test: t.id, comment, result: save(project, slug, t, r) };
}

const PICTURE = /^\.?(png|jpe?g|gif|bmp|webp)$/i;

export type AttachInput = { step?: number; file?: string; dataBase64?: string; name?: string };

// ponytail: a screenshot is copied into results/<testId>/ under a name of its own (capture-<8hex>.<ext>): a file the
// tester picked (absolute path) or a picture pasted in the page
export function attachCapture(project: string, slug: string, testId: string, a: AttachInput) {
  const t = testOf(project, slug, testId);
  if (!a.file === !a.dataBase64)
    throw new UserError("Give either a file or the picture's data.", "runs attach --file <absolute path>.");
  if (a.step !== undefined) stepIndex(t, a.step);
  let bytes: Uint8Array;
  let ext: string;
  if (a.file) {
    if (!isAbsolute(a.file)) throw new UserError(`${a.file} is not an absolute path.`, "Give the file's full path.");
    if (!existsSync(a.file) || !statSync(a.file).isFile()) throw new UserError(`No file ${a.file}.`, "Check the path.");
    ext = extname(a.file);
    bytes = new Uint8Array(readFileSync(a.file));
  } else {
    ext = extname(a.name ?? "") || ".png";
    bytes = new Uint8Array(Buffer.from((a.dataBase64 ?? "").replace(/^data:[^,]*,/, ""), "base64"));
  }
  if (!PICTURE.test(ext)) throw new UserError(`${ext} is not a picture.`, "Attach a .png, .jpg, .gif, .bmp or .webp.");
  if (!bytes.length) throw new UserError("The picture is empty.", "Take the screenshot again.");
  const file = `capture-${hex8()}.${ext.replace(/^\./, "").toLowerCase().replace("jpeg", "jpg")}`;
  writeAtomic(join(runDir(project, slug), "results", t.id, file), bytes);
  const r = readResult(project, slug, t);
  const attachment = { file, ...(a.step !== undefined ? { step: a.step } : {}) };
  r.attachments.push(attachment);
  return { test: t.id, attachment, result: save(project, slug, t, r) };
}

// ponytail: a screenshot taken off a test goes with its file; one the result does not list is refused, never a guess
export function detachCapture(project: string, slug: string, testId: string, file: string) {
  const t = testOf(project, slug, testId);
  const r = readResult(project, slug, t);
  const at = r.attachments.findIndex((a) => a.file === file);
  if (at < 0)
    throw new UserError(`No screenshot ${file} on this test.`, `testimus runs show ${slug} lists its screenshots.`);
  const [attachment] = r.attachments.splice(at, 1);
  if (/^capture-[0-9a-f]{8}\.[a-z]+$/.test(file))
    rmSync(join(runDir(project, slug), "results", t.id, file), { force: true });
  return { test: t.id, attachment, result: save(project, slug, t, r) };
}
