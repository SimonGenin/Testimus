export type AnchorKind = "§" | "fig" | "page";
export type Anchor = { kind: AnchorKind; id: string };

const KINDED = /^(fig|page)(?:\s*:\s*|\s+)(\S.*)$/i;
const PART = /~\d+$/;
const REF = /^([^#]+)#(.+)$/;

// ponytail: the one reading of an anchor as people and Claude write it — « 5.6.6 », « § 5.6.6 », « fig 40 »,
// « FIG: 40 », « page 3 », with or without its docId# in front and with a chunk part (~2) dropped
export function parseAnchor(raw: string): Anchor {
  const a = raw
    .trim()
    .replace(/^[^#\s]*#/, "")
    .replace(PART, "")
    .trim();
  const m = KINDED.exec(a);
  if (m) return { kind: m[1].toLowerCase() as AnchorKind, id: m[2].trim() };
  return { kind: "§", id: a.replace(/^§\s*/, "") };
}

export function anchorText(a: Anchor): string {
  return a.kind === "§" ? `§${a.id}` : `${a.kind}:${a.id}`;
}

export function normalizeAnchor(raw: string): string {
  return anchorText(parseAnchor(raw));
}

export function splitRef(ref: string): { docId: string; anchor: string | null } {
  const m = REF.exec(ref.trim());
  return m ? { docId: m[1].trim(), anchor: m[2] } : { docId: ref.trim(), anchor: null };
}

export function normalizeRef(ref: string): string {
  const { docId, anchor } = splitRef(ref);
  return anchor === null ? docId : `${docId}#${normalizeAnchor(anchor)}`;
}
