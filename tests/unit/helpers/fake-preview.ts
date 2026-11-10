import type { CommandOutput } from "../../../src/core/commands/index.ts";

export type Preview = CommandOutput<"claude.preview">;
export type Piece = Preview["pieces"][number];

const KIND: [RegExp, Piece["kind"], Piece["how"]][] = [
  [/^instruction$/, "instruction", "inline"],
  [/^skill:/, "skill", "auto"],
  [/^rules$/, "rules", "auto"],
  [/^tools$/, "tools", "auto"],
  [/^overview$/, "overview", "pointer"],
  [/^context:/, "context", "inline"],
  [/^doc:/, "document", "search"],
  [/^docnote:/, "docnote", "inline"],
];

const LOCKED: Piece["kind"][] = ["instruction", "skill", "rules", "tools"];

// ponytail: one piece of claude.preview's answer, from its id — the kind, how it is given and whether it is locked
// follow the id as the core writes them (claude/given.ts, claude/catalog.ts); the rest is said per piece
export function piece(id: string, name: string, o: Partial<Piece> = {}): Piece {
  const [, kind, how] = KIND.find(([re]) => re.test(id)) ?? [null, "note" as const, "inline" as const];
  return { id, kind, name, why: "", how, locked: LOCKED.includes(kind), on: true, chars: 0, ...o };
}

type Asked = { use?: string; contexts?: string[]; without?: string[]; note?: string; conversation?: string };

// ponytail: what claude.preview answers for these pieces and what the request picked — the core's rule in small: the
// saved contexts named replace the attached ones, a piece left out is off unless it is locked, what hangs under a piece
// left out goes with it (a document's note), the user's own words come last and always go
export function previewOf(base: Piece[], input: Record<string, unknown>): Preview {
  const asked = input as Asked;
  const without = new Set(asked.without ?? []);
  const picked = base.map((p): Piece => {
    if (p.kind !== "context") return { ...p, on: p.on && (p.locked || !without.has(p.id)) };
    const id = p.id.slice("context:".length);
    const on = (asked.contexts ? asked.contexts.includes(id) : p.on) && !without.has(p.id);
    return { ...p, on, why: on ? (p.on ? p.why : "Chosen for this run") : "Saved, not attached to this run" };
  });
  const pieces = picked.map((p) =>
    p.parent && picked.some((x) => x.id === p.parent && !x.on) ? { ...p, on: false } : p,
  );
  const words = (id: "note" | "conversation", name: string, text?: string): Piece[] =>
    text?.trim()
      ? [{ id, kind: id, name, why: "", how: "inline", locked: true, on: true, chars: text.trim().length, text }]
      : [];
  return {
    use: asked.use ?? "",
    kind: "run",
    name: "A request",
    answers: "",
    pieces: [
      ...pieces,
      ...words("note", "Your note for this run", asked.note),
      ...words("conversation", "The conversation so far", asked.conversation),
    ],
  };
}
