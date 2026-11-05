// ponytail: a comment's mentions — Jira's text form is @[Camille Martin](<account id>); the composer shows « @Camille
// Martin » and remembers who each name is, and puts the account back when it sends

const STORED = /@\[([^\]\n]+)\]\(([^)\s]+)\)/g;

export type Who = Map<string, string>;
export type Piece = { text: string } | { name: string; id: string };

/** a comment as Jira keeps it, cut into its text and its mentions (each drawn as a chip) */
export function pieces(body: string): Piece[] {
  const out: Piece[] = [];
  let at = 0;
  for (const m of body.matchAll(STORED)) {
    if (m.index > at) out.push({ text: body.slice(at, m.index) });
    out.push({ name: m[1], id: m[2] });
    at = m.index + m[0].length;
  }
  if (at < body.length) out.push({ text: body.slice(at) });
  return out;
}

/** a stored text (a Claude draft, a comment being edited) as the composer shows it, and who its names are */
export function forComposer(body: string, who: Who = new Map()): { text: string; who: Who } {
  const next = new Map(who);
  const text = body.replace(STORED, (_, name: string, id: string) => {
    next.set(name, id);
    return `@${name}`;
  });
  return { text, who: next };
}

const literal = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** the composer's text as Jira takes it: each « @Name » it knows becomes a mention (the longest names first) */
export function forJira(text: string, who: Who): string {
  const names = [...who.keys()].sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const any = new RegExp(`@(${names.map(literal).join("|")})(?![\\p{L}\\p{N}])`, "gu");
  return text.replace(any, (_, name: string) => `@[${name}](${who.get(name)})`);
}

/** the mention being typed just before the caret (« @cam »): where its @ is and what follows it */
export function typingMention(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|[\s(])@([\p{L}][\p{L}' -]{0,30})?$/u.exec(before);
  if (!m) return null;
  const query = m[2] ?? "";
  // ponytail: two spaces, or a third word, and it is a sentence again, not a name being typed
  if (/\s{2}/.test(query) || query.trim().split(/\s+/).length > 2) return null;
  return { start: m.index + m[1].length, query };
}

/** the text with the mention being typed replaced by the person's name (and a space after it) */
export function putMention(text: string, at: { start: number; query: string }, name: string): string {
  const end = at.start + 1 + at.query.length;
  const rest = text.slice(end);
  return `${text.slice(0, at.start)}@${name}${rest.startsWith(" ") ? "" : " "}${rest}`;
}
