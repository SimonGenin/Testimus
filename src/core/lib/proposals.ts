import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isShared } from "../claude/prompt.ts";
import { UserError } from "../command.ts";
import { env } from "../env.ts";
import type { Proposal, ProposalKind, ProposalState } from "../types.ts";
import { stepColumns } from "./columns.ts";
import { showContext } from "./contexts.ts";
import { OVERVIEW_PATH, readOverview } from "./overview.ts";
import { readJson, writeJson } from "./project.ts";
import { hex8 } from "./store.ts";

// ponytail: a change the chat proposes to a file no run may write — the overview, a saved context's notes, a smart
// column's description. Nothing is written until the user applies it (chat.apply, through the command that writes that
// file); .testimus/proposals/<id>.json keeps the text it was made against, so the page shows a diff and a file that
// moved since is refused, never overwritten unseen

const dir = (project: string) => join(project, ".testimus", "proposals");
const file = (project: string, id: string) => join(dir(project), `${id}.json`);

type Current = { name: string; text: string; mtime: number };

function current(project: string, kind: ProposalKind, target: string): Current {
  if (kind === "overview") {
    const o = readOverview(project);
    return { name: "How the documents fit together", text: o.body, mtime: o.mtime };
  }
  if (kind === "context") {
    const c = showContext(project, target);
    return { name: c.name, text: c.notes, mtime: c.mtime };
  }
  const col = stepColumns(project).find((c) => c.name === target);
  return { name: target, text: col?.description ?? "", mtime: 0 };
}

const same = (a: string, b: string) => a.replace(/\r\n/g, "\n").trim() === b.replace(/\r\n/g, "\n").trim();

export function propose(
  project: string,
  p: { kind: ProposalKind; target: string; after: string; why: string; runId: string },
): Proposal {
  const now = current(project, p.kind, p.target);
  if (same(now.text, p.after))
    throw new UserError(
      `That is already the text of ${now.name}.`,
      "Propose only a change: the whole new text, with what the user asked for changed.",
    );
  const out: Proposal = {
    id: `prop-${hex8()}`,
    kind: p.kind,
    target: p.target,
    name: now.name,
    before: now.text,
    after: p.after,
    why: p.why.trim(),
    runId: p.runId,
    at: env.now().toISOString(),
    mtime: now.mtime,
    state: "open",
  };
  writeJson(file(project, out.id), out);
  return out;
}

export function readProposal(project: string, id: string): Proposal {
  const p = /^[\w-]+$/.test(id) ? readJson<Proposal | null>(file(project, id), null) : null;
  if (!p?.id) throw new UserError(`No proposal ${id} in this project.`, "chat.show lists a conversation's proposals.");
  return p;
}

export function proposalsOf(project: string, runIds: string[]): Proposal[] {
  if (!runIds.length || !existsSync(dir(project))) return [];
  const runs = new Set(runIds);
  return readdirSync(dir(project))
    .filter((f) => f.endsWith(".json"))
    .map((f) => readJson<Proposal | null>(join(dir(project), f), null))
    .filter((p): p is Proposal => !!p?.id && runs.has(p.runId))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function settle(project: string, id: string, state: Exclude<ProposalState, "open">): Proposal {
  const p = readProposal(project, id);
  if (p.state !== "open")
    throw new UserError(`The proposal for ${p.name} is already ${p.state}.`, "Nothing more to do with it.");
  const out = { ...p, state, settledAt: env.now().toISOString() };
  writeJson(file(project, id), out);
  return out;
}

// ponytail: the file a proposal changes, relative to the project — none for a context of the shared library, which
// lives outside it (applied all the same, but the run's Revert cannot reach it)
export function fileOf(project: string, p: Proposal): string | null {
  if (p.kind === "overview") return OVERVIEW_PATH;
  if (p.kind === "column") return "columns.json";
  return isShared(project, p.target) ? null : `contexts/${p.target}/context.md`;
}

// ponytail: columns.json has no mtime of its own to compare (columns.save takes none): a column's description is
// compared as it was proposed against
export const columnMoved = (project: string, p: Proposal): boolean =>
  !same(current(project, "column", p.target).text, p.before);
