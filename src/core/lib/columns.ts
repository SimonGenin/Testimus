import { UserError } from "../command.ts";
import type { ColumnDef, StepColumn, Trace, XrayField, XrayJson } from "../types.ts";
import { fieldOrder, localColumns, readProject, readXray, writeProject, writeXray } from "./project.ts";
import { projectTraces, type Scope, scanTrace, scopeIds } from "./traces.ts";

export const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  Action: "One operator gesture per step, in the imperative, on an object named as the screen names it.",
  Data: "The values entered or the object aimed at (code, position, track), only when the action needs them.",
  "Expected Result":
    "Everything the operator observes after the gesture, checkable on screen, in the words of the document.",
};

const RESERVED = /^(sources|description|attachments|expected|result|step)$/i;
const MAX_IDS = 300;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function defOf(x: XrayJson, name: string, field?: XrayField): ColumnDef | undefined {
  const defs = x.columns ?? [];
  return (field && defs.find((c) => c.id === field.id)) ?? defs.find((c) => same(c.name, name));
}

const traceOn = (traces: Trace[], name: string) => traces.find((t) => same(t.field, name));

// ponytail: an id column never described keeps what the generation always wrote there, so a project from before
// the descriptions generates as it did; an empty description the team saved is kept empty
function defaultDescription(name: string, builtin: boolean, trace?: Trace): string | undefined {
  if (builtin) return DEFAULT_DESCRIPTIONS[name] ?? "";
  if (trace) return `The ${trace.label} ids this step actually verifies, comma-separated.`;
  return undefined;
}

export function stepColumns(project: string, x: XrayJson = readXray(project)): StepColumn[] {
  const traces = projectTraces(project).traces;
  const local = new Set(localColumns(x));
  const names = fieldOrder(x);
  // ponytail: an id column tracked before its Xray field exists is a local column until the team adds the field
  for (const t of traces)
    if (!names.some((n) => same(n, t.field))) {
      names.push(t.field);
      local.add(t.field);
    }
  return names.map((name) => {
    const field = local.has(name) ? undefined : x.fields.find((f) => f.name === name);
    const def = defOf(x, name, field);
    const builtin = !!field?.builtin;
    const fallback = defaultDescription(name, builtin, traceOn(traces, name));
    return {
      name,
      origin: field ? "xray" : "local",
      builtin,
      status: field ? (!def && fallback === undefined ? "new" : "ok") : def?.id ? "gone" : "ok",
      description: def?.description ?? fallback ?? "",
    };
  });
}

function checkName(x: XrayJson, name: string): void {
  if (!name) throw new UserError("A column needs a name.", "E.g. « Remarque testeur ».");
  if (/[\r\n#]/.test(name) || name.length > 60)
    throw new UserError(`« ${name} » cannot be a column name.`, "One line, at most 60 characters, no #.");
  if (RESERVED.test(name))
    throw new UserError(`« ${name} » is a section of test.md, not a column.`, "Choose another name.");
  if (x.fields.some((f) => same(f.name, name)) || localColumns(x).some((n) => same(n, name)))
    throw new UserError(`The column « ${name} » already exists.`, "columns.list shows them.");
}

export function saveColumn(project: string, input: { name: string; description?: string }): StepColumn[] {
  const x = readXray(project);
  const name = input.name.trim();
  const description = input.description?.trim() ?? "";
  const defs = [...(x.columns ?? [])];
  const field = x.fields.find((f) => same(f.name, name));
  const def = defOf(x, name, field);
  if (def) {
    const at = defs.indexOf(def);
    defs[at] = { ...def, ...(field ? { name: field.name, id: field.id } : {}), description };
  } else if (field) defs.push({ name: field.name, id: field.id, description });
  else {
    checkName(x, name);
    defs.push({ name, description });
  }
  const next = { ...x, columns: defs };
  writeXray(project, next);
  return stepColumns(project, next);
}

export function removeColumn(project: string, name: string): StepColumn[] {
  const x = readXray(project);
  const local = stepColumns(project, x).find((c) => c.origin === "local" && same(c.name, name))?.name;
  if (!local)
    throw new UserError(
      x.fields.some((f) => same(f.name, name))
        ? `« ${name} » is a step field of Xray: it can be hidden, not removed.`
        : `No column called « ${name} ».`,
      "columns.list shows the columns.",
    );
  const drop = (l: string[]) => l.filter((n) => !same(n, local));
  const next: XrayJson = {
    ...x,
    columns: (x.columns ?? []).filter((c) => !same(c.name, local)),
    prefs: {
      ...x.prefs,
      order: drop(x.prefs.order),
      collapsed: drop(x.prefs.collapsed),
      hidden: drop(x.prefs.hidden),
      filled: drop(x.prefs.filled ?? []),
      ...(x.prefs.open ? { open: drop(x.prefs.open) } : {}),
    },
  };
  writeXray(project, next);
  const p = readProject(project);
  if (p.traces?.some((t) => same(t.field, local)))
    writeProject(project, { ...p, traces: p.traces.filter((t) => !same(t.field, local)) });
  return stepColumns(project, next);
}

// ponytail: Xray is read again — a field renamed there (same id) carries its description, folding and tracked
// ids to the new name; a field Xray dropped stays as a local column so the text the tests hold is never lost;
// a local column the team then created in Xray becomes that field
export function followXray(project: string, before: XrayJson, fields: XrayField[]): XrayJson {
  const renames = new Map<string, string>();
  const known = [...before.fields, ...(before.columns ?? []).filter((c) => c.id)];
  for (const f of known) {
    const now = fields.find((n) => n.id === f.id);
    if (now && now.name !== f.name) renames.set(f.name, now.name);
  }
  const rename = (n: string) => renames.get(n) ?? n;
  const defs: ColumnDef[] = (before.columns ?? []).map((c) => {
    const byId = c.id ? fields.find((f) => f.id === c.id) : undefined;
    if (byId) return { ...c, name: byId.name };
    const byName = !c.id ? fields.find((f) => same(f.name, c.name)) : undefined;
    return byName ? { ...c, name: byName.name, id: byName.id } : c;
  });
  for (const f of before.fields)
    if (!f.builtin && !fields.some((n) => n.id === f.id) && !defs.some((c) => c.id === f.id || same(c.name, f.name)))
      defs.push({ name: f.name, id: f.id });
  const p = before.prefs;
  const next: XrayJson = {
    ...before,
    fields,
    prefs: {
      ...p,
      order: p.order.map(rename),
      collapsed: p.collapsed.map(rename),
      hidden: p.hidden.map(rename),
      filled: (p.filled ?? []).map(rename),
      ...(p.open ? { open: p.open.map(rename) } : {}),
    },
    ...(defs.length ? { columns: defs } : {}),
  };
  const proj = readProject(project);
  if (renames.size && proj.traces?.some((t) => renames.has(t.field)))
    writeProject(project, { ...proj, traces: proj.traces.map((t) => ({ ...t, field: rename(t.field) })) });
  return next;
}

// ponytail: the columns are said in the request, so the generate-tests skill writes a column it has never heard
// of; an id column carries its pattern and, when the generation has a scope, every id written in that scope
export function columnGuidance(project: string, scope?: Scope): string[] {
  const columns = stepColumns(project);
  const traces = projectTraces(project).traces;
  const lines = ["", "Step columns — write each as ### <column> in every step, following its description:"];
  const empty: string[] = [];
  for (const c of columns) {
    if (!c.description) {
      empty.push(c.name);
      continue;
    }
    lines.push(`- ### ${c.name}: ${c.description}`);
    const t = traceOn(traces, c.name);
    if (!t) continue;
    let examples: string[] = [];
    try {
      examples = scanTrace(project, t.patterns, { limit: 3 }).items.map((i) => i.id);
    } catch {}
    lines.push(
      `  Ids only as the documents write them (pattern ${t.patterns.join(" | ")}${examples.length ? `, e.g. ${examples.join(", ")}` : ""}); leave the column out of a step that verifies none.`,
    );
    if (!scope) continue;
    let ids: string[] = [];
    try {
      ids = scopeIds(project, t.patterns, scope);
    } catch {}
    if (ids.length)
      lines.push(
        `  ${t.label} ids written in the scope, each to be verified by at least one step (report the ones you cannot cover): ${ids.slice(0, MAX_IDS).join(", ")}${ids.length > MAX_IDS ? ` and ${ids.length - MAX_IDS} more — find them with rag_mentions` : ""}`,
      );
  }
  if (empty.length) lines.push(`Leave these columns empty — never write them: ${empty.join(", ")}.`);
  return lines;
}
