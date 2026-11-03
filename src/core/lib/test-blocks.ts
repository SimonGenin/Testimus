import { tablesIn } from "../../shared/table.ts";
import type { Block, Step, StepImage, Test } from "../types.ts";

// ponytail: an embedded image is a markdown ref inside the field text — one string per field, so the
// file, the parser, the dirty check and Claude all keep treating a field as text
const REF = /!\[\]\(([^()\s"]+)(?:\s+"([^"]*)")?\)/g;
const RAW = /!xray-attachment:\/\/[^!\n]*!/;
// ponytail: an image Xray embeds by address instead of by attachment — a live external URL, or the
// dead `blob:` a paste left behind. Read-only: it is drawn from its own URL, never created here. It
// names no attachment id, so unlike RAW a rebuild cannot break it and the step stays pushable.
// RAW comes first in SCAN, so an `xray-attachment://` never falls through to here
const EXTERN = /!((?:[a-z][a-z0-9+.-]*:)+\/\/[^!\n|]+)(?:\|([^!\n]*))?!/;
const SCAN = new RegExp([REF.source, RAW.source, EXTERN.source].join("|"), "g");

export const imageRef = (file: string, params = "") => `![](${file}${params ? ` "${params}"` : ""})`;

export const mapRefs = (text: string, fn: (file: string, params: string, ref: string) => string) =>
  text.replace(REF, (m: string, file: string, params?: string) => fn(file, params ?? "", m));

// ponytail: blocks carry their offsets, so every edit is one splice — only the one blank line that
// separates two blocks belongs to neither, every other space the user typed stays in its block
export function blocksOf(text: string, images: StepImage[]): Block[] {
  const out: Block[] = [];
  let from = 0;
  for (const t of tablesIn(text)) {
    out.push(...scan(text, images, from, t.at), { kind: "table", ...t });
    from = t.end;
  }
  out.push(...scan(text, images, from, text.length));
  return out;
}

function scan(text: string, images: StepImage[], spanFrom: number, spanTo: number): Block[] {
  const out: Block[] = [];
  const pushText = (from: number, to: number) => {
    const raw = text.slice(from, to);
    if (!raw.trim()) return;
    const at = from + (from > 0 ? (/^\n\n?/.exec(raw)?.[0].length ?? 0) : 0);
    const end = to - (to < text.length ? (/\n\n?$/.exec(raw)?.[0].length ?? 0) : 0);
    out.push({ kind: "text", text: text.slice(at, end), at, end });
  };
  let last = spanFrom;
  SCAN.lastIndex = spanFrom;
  for (let m = SCAN.exec(text); m && m.index < spanTo; m = SCAN.exec(text)) {
    const at = m.index;
    const image = m[1] ? images.find((im) => im.file === m[1]) : undefined;
    // ponytail: a ref to a file the step does not attach is not an image — it stays the text it is
    if (m[1] && !image) continue;
    pushText(last, at);
    out.push(
      image
        ? { kind: "image", image, params: m[2] ?? "", at, end: at + m[0].length }
        : m[3]
          ? { kind: "extern", url: m[3], params: m[4] ?? "", at, end: at + m[0].length }
          : { kind: "raw", text: m[0], at, end: at + m[0].length },
    );
    last = at + m[0].length;
  }
  pushText(last, spanTo);
  return out;
}

// ponytail: a table cell holds blocks of the same field, so every question about "what is in this
// field" is asked here and nowhere else — a screenshot in a cell is embedded, an embed Xray dropped in
// a cell still makes the step unpushable. Offsets stay absolute, so a leaf block splices like any other.
export const leafBlocks = (text: string, images: StepImage[]): Block[] =>
  blocksOf(text, images).flatMap((b) =>
    b.kind === "table"
      ? b.rows.flatMap((r) =>
          r.cells.flatMap((c) => leafBlocks(c.text, images).map((n) => ({ ...n, at: n.at + c.at, end: n.end + c.at }))),
        )
      : [b],
  );

// ponytail: an attachment is a file of the test folder — never absolute, never a drive, never above
// the folder — or a push would upload whatever it names
export const insideTest = (file: string) =>
  file.trim() !== "" &&
  !/^[\\/]/.test(file) &&
  !/^[A-Za-z]:/.test(file) &&
  !/^file:/i.test(file) &&
  !file.split(/[\\/]/).includes("..");

const WEB = /^https?:\/\//i;

export function outsideTest(test: Test): string[] {
  const out: string[] = [];
  test.steps.forEach((s, n) => {
    for (const im of s.images)
      if (!insideTest(im.file))
        out.push(`Step ${n + 1}: attachment "${im.file}" is not a file inside the test folder (images/…)`);
    for (const text of Object.values(s.fields))
      mapRefs(text, (file, _params, ref) => {
        if (!WEB.test(file) && !insideTest(file))
          out.push(`Step ${n + 1}: image "${file}" is not a file inside the test folder (images/…)`);
        return ref;
      });
  });
  return out;
}

export const hasRawEmbed = (s: Step) =>
  Object.values(s.fields).some((t) => leafBlocks(t, s.images).some((b) => b.kind === "raw"));
