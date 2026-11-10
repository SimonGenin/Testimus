import type { CommandInput, CommandOutput } from "../../../core/commands/index.ts";
import { plural } from "../../lib/format.ts";
import type { IconName } from "../ui/Icon.tsx";
import { kilo } from "./turns.ts";

export type Preview = CommandOutput<"claude.preview">;
export type Piece = Preview["pieces"][number];
/** the request a block sends: the prompt's id and what it is about, as claude.preview takes them — a request on a
 * generation names it, so what is shown is what that generation ran with */
export type Asked = Pick<CommandInput<"claude.preview">, "use" | "scope" | "docs" | "sections" | "generation">;
/** what the user chose for one run, as every run command takes it: spread into its input */
export type RunPick = { contexts?: string[]; without?: string[] };

/** how a piece reaches Claude: the word said in full, and the short one beside its size in a row (none when said) */
export const HOW: Record<Piece["how"], { icon: IconName; word: string; short?: string }> = {
  inline: { icon: "text", word: "Said in full" },
  pointer: { icon: "link", word: "Pointed at", short: "pointed at" },
  auto: { icon: "download", word: "Loaded by Claude Code", short: "loaded" },
  search: { icon: "search", word: "Searched as Claude works", short: "searched" },
};

export const ICON: Record<Piece["kind"], IconName> = {
  instruction: "send",
  skill: "layers",
  rules: "file",
  tools: "terminal",
  overview: "tree",
  context: "context",
  document: "documents",
  docnote: "quote",
  note: "keyboard",
  conversation: "history",
};

export const CONTEXTS = "Your contexts";

// ponytail: what can be changed first — the saved contexts, the documents, the background, the user's words —, what
// every run of this kind is given last
const GROUPS: { label: string; kinds: Piece["kind"][] }[] = [
  { label: CONTEXTS, kinds: ["context"] },
  { label: "Documents", kinds: ["document", "docnote"] },
  { label: "Background", kinds: ["overview"] },
  { label: "Your words", kinds: ["note", "conversation"] },
  { label: "Always given", kinds: ["instruction", "skill", "rules", "tools"] },
];

export type PieceGroup = { label: string; pieces: Piece[] };

export const CONTEXT = "context:";
export const contextId = (p: Piece) => p.id.slice(CONTEXT.length);

const count = (chars: number) => kilo(Math.round(chars / 4));
export const tokens = (chars: number) => `~${count(chars)} tokens`;
/** a size beside a name, where the column says it is tokens */
export const tokensShort = (chars: number) => `~${count(chars)}`;

export const changed = (pick: RunPick) => !!pick.contexts || !!pick.without?.length;

const NONE: RunPick = {};

/** a pick kept with a block's unsent draft, read back */
export function pickOf(raw: string): RunPick {
  try {
    return raw ? (JSON.parse(raw) as RunPick) : NONE;
  } catch {
    return NONE;
  }
}

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

// ponytail: one tick, said the way the run commands take it — a piece left out goes to `without` (so the contexts the
// run attaches by itself stay its own to decide), a saved context that was not attached makes `contexts` the whole
// list; back to what the run attaches, nothing is passed at all. `base` is the preview with nothing picked
export function toggle(pick: RunPick, base: Piece[], piece: string, on: boolean): RunPick {
  const without = new Set(pick.without ?? []);
  const attached = base.filter((p) => p.kind === "context" && p.on).map(contextId);
  let list = pick.contexts ?? attached;
  if (on) without.delete(piece);
  if (piece.startsWith(CONTEXT)) {
    const id = piece.slice(CONTEXT.length);
    if (on && !list.includes(id)) list = [...list, id];
    if (!on && attached.includes(id)) without.add(piece);
    if (!on && !attached.includes(id)) list = list.filter((x) => x !== id);
  } else if (!on) without.add(piece);
  return {
    ...(sameIds(list, attached) ? {} : { contexts: list }),
    ...(without.size ? { without: [...without] } : {}),
  };
}

export const countOn = (pieces: Piece[]) => pieces.filter((p) => p.on).length;

/** what Claude holds as it starts: what is said, loaded or read first — a document is searched, never sent whole */
export const held = (pieces: Piece[]) => pieces.filter((p) => p.on && p.how !== "search");

// ponytail: the total in words — the tokens Claude starts with, and apart, the documents it may search
export function totalOf(pieces: Piece[]): { start: string; searched?: string } {
  const start = tokens(held(pieces).reduce((n, p) => n + p.chars, 0));
  const docs = pieces.filter((p) => p.on && p.kind === "document");
  if (!docs.length) return { start };
  const size = docs.reduce((n, p) => n + p.chars, 0);
  return { start, searched: `searches ${plural(docs.length, "document")} (${tokens(size)}), never sent whole` };
}

// ponytail: the pieces in the dialog's groups — the saved contexts' group stays when empty (the library is managed
// there), the others go
export const groupsOf = (pieces: Piece[]): PieceGroup[] =>
  GROUPS.map((g) => ({ label: g.label, pieces: pieces.filter((p) => g.kinds.includes(p.kind)) })).filter(
    (g) => g.pieces.length > 0 || g.label === CONTEXTS,
  );
