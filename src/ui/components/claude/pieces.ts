import type { ReactNode } from "react";
import type { CommandInput, CommandOutput } from "../../../core/commands/index.ts";
import { plural } from "../../lib/format.ts";
import type { FlowGroup, FlowNode } from "../ui/FlowMap.tsx";
import type { IconName } from "../ui/Icon.tsx";
import { kilo } from "./turns.ts";

export type Preview = CommandOutput<"claude.preview">;
export type Piece = Preview["pieces"][number];
/** the request a block sends: the prompt's id and what it is about, as claude.preview takes them — a request on a
 * generation names it, so what is shown is what that generation ran with */
export type Asked = Pick<CommandInput<"claude.preview">, "use" | "scope" | "docs" | "sections" | "generation">;
/** what the user chose for one run, as every run command takes it: spread into its input */
export type RunPick = { contexts?: string[]; without?: string[] };

const HOW: Record<Piece["how"], { icon: IconName; word: string }> = {
  inline: { icon: "text", word: "Said in full" },
  pointer: { icon: "link", word: "Pointed at" },
  auto: { icon: "download", word: "Loaded by Claude Code" },
  search: { icon: "search", word: "Searched" },
};

const ICON: Record<Piece["kind"], IconName> = {
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

const GROUPS: { label: string; kinds: Piece["kind"][] }[] = [
  { label: "The request", kinds: ["instruction", "skill", "rules", "tools"] },
  { label: "Background", kinds: ["overview"] },
  { label: "Contexts", kinds: ["context"] },
  { label: "Documents", kinds: ["document", "docnote"] },
  { label: "Your words", kinds: ["note", "conversation"] },
];

export const CONTEXT = "context:";
export const contextId = (p: Piece) => p.id.slice(CONTEXT.length);

export const tokens = (chars: number) => `~${kilo(Math.round(chars / 4))} tokens`;

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

// ponytail: the total says what Claude holds as it starts — what is said, loaded or read first; a document is searched,
// never sent whole, so its size is told apart
export function totalOf(pieces: Piece[]): { total: string; note: string } {
  const on = pieces.filter((p) => p.on);
  const held = on.filter((p) => p.how !== "search").reduce((n, p) => n + p.chars, 0);
  const searched = on.filter((p) => p.kind === "document");
  return {
    total: `${on.length} of ${plural(pieces.length, "piece")} · ${tokens(held)}`,
    note: searched.length
      ? `Said, loaded or read first. ${plural(searched.length, "document")} more to search, never sent whole.`
      : "Said, loaded or read first.",
  };
}

// ponytail: the pieces as the graph draws them — the request, the background, the saved contexts (always shown: the
// library is managed there), the documents each with what the team wrote about it under it, the user's own words
export function groupsOf(
  pieces: Piece[],
  o: {
    /** a piece that cannot be ticked here though the run could leave it out: the reason */
    lock?: (p: Piece) => string | undefined;
    /** at the end of a piece's row (a saved context: Edit) */
    actions?: (p: Piece) => ReactNode;
    /** under the saved contexts: New context, Save the text as a context, Copy from another project */
    library?: ReactNode;
  } = {},
): FlowGroup[] {
  const node = (p: Piece): FlowNode => ({
    id: p.id,
    name: p.name,
    on: p.on,
    locked: p.locked || o.lock?.(p),
    icon: ICON[p.kind],
    how: HOW[p.how],
    size: p.chars ? tokens(p.chars) : undefined,
    weight: p.chars,
    why: p.why,
    detail: [p.detail, p.how === "pointer" || p.how === "auto" ? p.path : ""].filter(Boolean).join(" · ") || undefined,
    text: p.text,
    under: !!p.parent && pieces.some((x) => x.id === p.parent),
    actions: o.actions?.(p),
  });
  return GROUPS.map((g) => ({
    label: g.label,
    nodes: pieces.filter((p) => g.kinds.includes(p.kind)).map(node),
    ...(g.label === "Contexts"
      ? { empty: "No saved context yet. Create one, or write in the box and save the text as one.", actions: o.library }
      : {}),
  })).filter((g) => g.nodes.length > 0 || g.label === "Contexts");
}
