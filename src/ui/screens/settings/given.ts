import type { CommandOutput } from "../../../core/commands/index.ts";
import type { ContextSummary } from "../../components/claude/contexts.ts";
import { kilo } from "../../components/claude/turns.ts";
import { fold } from "../../lib/format.ts";
import { contextLabel } from "../../lib/labels.ts";

export type Given = CommandOutput<"claude.prompts">[number];
/** a prompt Testimus builds that a run sends: it has a kind of run, and what goes with every run of that kind */
export type Run = Given & { kind: string; takes: NonNullable<Given["takes"]> };
export type Preview = CommandOutput<"claude.preview">;
export type Piece = Preview["pieces"][number];

export const isRun = (p: Given): p is Run => p.origin === "built" && !!p.kind && !!p.takes;

// ponytail: a weight in the words people budget with — about four characters to a token, said as « ~1.2k tokens »
export const tokens = (chars: number) => `~${kilo(Math.round(chars / 4))} tokens`;

// ponytail: what Claude holds as a run starts — what is said, loaded or read first; a document is searched, never sent
// whole, so its size is not part of it
export const held = (p: Piece) => p.on && p.how !== "search";
export const heldChars = (pieces: Piece[]) => pieces.filter(held).reduce((n, p) => n + p.chars, 0);

// ponytail: the parts a built prompt fills per run are its {placeholders}; a JSON example ({"tests": …}) or a tool's
// input ({ id, page }) starts with a quote or a space and is not one
export const slots = (text: string) => [...new Set(text.match(/\{[A-Za-z][^{}\n":]*\}/g) ?? [])];

// ponytail: one row of the section's list — a run (a prompt Testimus builds and sends), a piece that goes with runs
// (a skill, a project file, a template), or a saved context: the part the user writes, the one kind edited here
export type Entry =
  | { key: string; kind: "run"; group: string; given: Run }
  | { key: string; kind: "piece"; group: string; given: Given }
  | { key: string; kind: "context"; group: string; context: ContextSummary; isDefault: boolean; notes: string };

export const CONTEXTS = "This project's contexts";
export const EVERY_RUN = "Every run";

export const ORIGIN: Record<Given["origin"], string> = {
  skill: "Skill",
  built: "Built per run",
  file: "File",
  context: "Context",
};

// ponytail: the saved contexts first — all of them, a default or not (claude.prompts lists only the defaults, as
// files: they are left out for the library's own rows) — then what goes with every run, then what the core lists, in
// its order
export function entriesOf(prompts: Given[], contexts: ContextSummary[], defaults: string[]): Entry[] {
  const notes = new Map(prompts.filter((p) => p.origin === "context").map((p) => [p.id, p.text]));
  const listed = prompts.filter((p) => p.origin !== "context");
  return [
    ...contexts.map(
      (c): Entry => ({
        key: `context:${c.id}`,
        kind: "context",
        group: CONTEXTS,
        context: c,
        isDefault: defaults.includes(c.id),
        notes: notes.get(`context:${c.id}`) ?? "",
      }),
    ),
    ...[...listed.filter((p) => p.group === EVERY_RUN), ...listed.filter((p) => p.group !== EVERY_RUN)].map(
      (p): Entry =>
        isRun(p)
          ? { key: p.id, kind: "run", group: p.group, given: p }
          : { key: p.id, kind: "piece", group: p.group, given: p },
    ),
  ];
}

export const entryName = (e: Entry) => (e.kind === "context" ? contextLabel(e.context) : e.given.name);

export const where = (c: ContextSummary) => (c.shared ? "Shared library" : "This project");

export function matches(e: Entry, words: string[]): boolean {
  const hay = fold(
    (e.kind === "context"
      ? [
          contextLabel(e.context),
          e.group,
          "Context",
          where(e.context),
          e.isDefault ? "Default" : "",
          e.context.paths.join(" "),
          e.context.files.join(" "),
          e.notes,
        ]
      : [
          e.given.name,
          e.given.group,
          e.kind === "run" ? `Run ${e.given.kind}` : ORIGIN[e.given.origin],
          e.given.path ?? "",
          e.given.usedBy.join(" "),
          e.given.answers ?? "",
          e.given.text,
        ]
    ).join("\n"),
  );
  return words.every((w) => hay.includes(w));
}
