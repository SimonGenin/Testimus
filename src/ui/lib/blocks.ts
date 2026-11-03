import type { Block, Step, StepImage } from "../../core/types.ts";
import { tablesIn } from "../../shared/table.ts";

const REF = /!\[\]\(([^()\s"]+)(?:\s+"([^"]*)")?\)/;
const RAW = /!xray-attachment:\/\/[^!\n]*!/;
const EXTERN = /!((?:[a-z][a-z0-9+.-]*:)+\/\/[^!\n|]+)(?:\|([^!\n]*))?!/;
const SCAN = new RegExp([REF.source, RAW.source, EXTERN.source].join("|"), "g");

export const imageRef = (file: string, params = "") => `![](${file}${params ? ` "${params}"` : ""})`;

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

export const leafBlocks = (text: string, images: StepImage[]): Block[] =>
  blocksOf(text, images).flatMap((b) =>
    b.kind === "table"
      ? b.rows.flatMap((r) =>
          r.cells.flatMap((c) => leafBlocks(c.text, images).map((n) => ({ ...n, at: n.at + c.at, end: n.end + c.at }))),
        )
      : [b],
  );

export const hasRawEmbed = (s: Step) =>
  Object.values(s.fields).some((t) => leafBlocks(t, s.images).some((b) => b.kind === "raw"));

export const blankStep = (): Step => ({ fields: {}, sources: [], images: [] });
