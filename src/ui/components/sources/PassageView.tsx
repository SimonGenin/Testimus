import type { ReactNode } from "react";
import type { Passage } from "../../../core/types.ts";
import { fileUrl } from "../../api.ts";
import { Badge, type BadgeTone } from "../ui/index.ts";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

type Run = { text: string; strong: boolean; em: boolean };

// ponytail: doc.md keeps Word bold/italic as **…** and *…* (converter rule); a lone * followed by a
// space stays a literal star
export function emphasisRuns(md: string): Run[] {
  const out: Run[] = [];
  let strong = false;
  let em = false;
  let buf = "";
  const flush = () => {
    if (buf) out.push({ text: buf, strong, em });
    buf = "";
  };
  for (let k = 0; k < md.length; k++) {
    if (md.startsWith("**", k) && (strong || md.indexOf("**", k + 2) > 0)) {
      flush();
      strong = !strong;
      k++;
    } else if (md[k] === "*" && (em || (/\S/.test(md[k + 1] ?? "") && md.indexOf("*", k + 1) > 0))) {
      flush();
      em = !em;
    } else buf += md[k];
  }
  flush();
  return out;
}

// ponytail: the quote is found whitespace-normalised (SPEC §6), so the match is made on a squeezed copy
// and mapped back to the original offsets through an index of kept characters
function findQuote(text: string, quote: string): [number, number] | null {
  const q = norm(quote.replace(/\*/g, ""));
  if (!q) return null;
  const keep: number[] = [];
  let squeezed = "";
  for (let i = 0; i < text.length; i++) {
    const c = /\s/.test(text[i]) ? " " : text[i].toLowerCase();
    if (c === " " && (squeezed.endsWith(" ") || !squeezed)) continue;
    squeezed += c;
    keep.push(i);
  }
  const at = squeezed.indexOf(q);
  if (at < 0) return null;
  return [keep[at], keep[at + q.length - 1] + 1];
}

export function highlight(md: string, quote: string): ReactNode[] {
  const runs = emphasisRuns(md);
  const hit = findQuote(runs.map((r) => r.text).join(""), quote);
  const out: ReactNode[] = [];
  let at = 0;
  for (const r of runs) {
    const end = at + r.text.length;
    const cuts = hit ? [at, Math.min(Math.max(hit[0], at), end), Math.min(Math.max(hit[1], at), end), end] : [at, end];
    for (let c = 0; c < cuts.length - 1; c++) {
      if (cuts[c] === cuts[c + 1]) continue;
      const piece = r.text.slice(cuts[c] - at, cuts[c + 1] - at);
      const key = out.length;
      let node: ReactNode =
        hit && cuts[c] >= hit[0] && cuts[c + 1] <= hit[1] ? (
          <mark key={`m${key}`} className="hl">
            {piece}
          </mark>
        ) : (
          piece
        );
      if (r.em) node = <em key={`e${key}`}>{node}</em>;
      if (r.strong) node = <strong key={`s${key}`}>{node}</strong>;
      out.push(node);
    }
    at = end;
  }
  return out;
}

export const DOC_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Submitted", tone: "info" },
  validated: { label: "Validated", tone: "ok" },
  superseded: { label: "Superseded", tone: "warn" },
};

export const BINDING: Record<string, string> = {
  mandatory: "Mandatory",
  applicable: "Applicable",
  informative: "Informative",
};

export const paragraphs = (text: string) =>
  text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^!\[[^\]]*\]\([^)]*\)\s*$/gm, "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

export const sectionNumber = (anchor: string) => (anchor.startsWith("§") ? anchor.slice(1) : "");

export function DocBadges({ status, binding }: { status: string; binding: string }) {
  const s = DOC_STATUS[status] ?? { label: status, tone: "neutral" as const };
  return (
    <>
      <Badge tone={s.tone}>{s.label}</Badge>
      <Badge>{BINDING[binding] ?? binding}</Badge>
    </>
  );
}

export function PassageText({ passage, quote }: { passage: Passage; quote: string }) {
  const mark = quote || passage.focus || "";
  const num = sectionNumber(passage.anchor);
  return (
    <>
      {passage.path && <span className="muted passage-path">{passage.path.split(" > ").join(" › ")}</span>}
      {passage.title && (
        <h4 className="h passage-title">
          {num && !passage.title.startsWith(num) ? `${num} ` : ""}
          {passage.title}
        </h4>
      )}
      <div className="passage-text">
        {paragraphs(passage.text).map((para, i) => (
          <p key={i}>{highlight(para, mark)}</p>
        ))}
      </div>
      {passage.figures.map((f) => (
        <figure key={f.file} className="passage-fig">
          <img src={fileUrl(`docs/${passage.docId}/${f.file}`)} alt={f.caption || f.file} />
          <figcaption className="muted">{f.caption}</figcaption>
        </figure>
      ))}
    </>
  );
}
