import { UserError } from "../command.ts";
import type { ColumnDef, StepColumn, XrayField, XrayJson } from "../types.ts";
import { fieldOrder, localColumns, readXray, writeXray } from "./project.ts";

export const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  Action: "One operator gesture per step, in the imperative, on an object named as the screen names it.",
  Data: "The values entered or the object aimed at (code, position, track), only when the action needs them.",
  "Expected Result":
    "Everything the operator observes after the gesture, checkable on screen, in the words of the document.",
};

const RESERVED = /^(sources|description|attachments|expected|result|step)$/i;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function defOf(x: XrayJson, name: string, field?: XrayField): ColumnDef | undefined {
  const defs = x.columns ?? [];
  return (field && defs.find((c) => c.id === field.id)) ?? defs.find((c) => same(c.name, name));
}

export function stepColumns(project: string, x: XrayJson = readXray(project)): StepColumn[] {
  const local = new Set(localColumns(x));
  return fieldOrder(x).map((name) => {
    const field = local.has(name) ? undefined : x.fields.find((f) => f.name === name);
    const def = defOf(x, name, field);
    const builtin = !!field?.builtin;
    const fallback = builtin ? (DEFAULT_DESCRIPTIONS[name] ?? "") : undefined;
    return {
      name,
      origin: field ? "xray" : "local",
      builtin,
      status: field ? (!def && fallback === undefined ? "new" : "ok") : def?.id ? "gone" : "ok",
      description: def?.description ?? fallback ?? "",
      referenceSource: !!def?.referenceSource,
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

// ponytail: what the input leaves out is kept — a description saved alone keeps the column's Reference source
export function saveColumn(
  project: string,
  input: { name: string; description?: string; referenceSource?: boolean },
): StepColumn[] {
  const x = readXray(project);
  const name = input.name.trim();
  const change = {
    ...(input.description !== undefined && { description: input.description.trim() }),
    ...(input.referenceSource !== undefined && { referenceSource: input.referenceSource }),
  };
  const defs = [...(x.columns ?? [])];
  const field = x.fields.find((f) => same(f.name, name));
  const def = defOf(x, name, field);
  if (def) {
    const at = defs.indexOf(def);
    defs[at] = { ...def, ...(field ? { name: field.name, id: field.id } : {}), ...change };
  } else if (field) defs.push({ name: field.name, id: field.id, ...change });
  else {
    checkName(x, name);
    defs.push({ name, description: "", ...change });
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
  return stepColumns(project, next);
}

// ponytail: Xray is read again — a field renamed there (same id) carries its description and folding to the new
// name; a field Xray dropped stays as a local column so the text the tests hold is never lost;
// a local column the team then created in Xray becomes that field
export function followXray(before: XrayJson, fields: XrayField[]): XrayJson {
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
  return next;
}

// ponytail: the smart columns are said in the request, so the generate-tests skill writes a column it has never
// heard of, following its description
export function columnGuidance(project: string): string[] {
  const lines = ["", "Smart columns — write each as ### <column> in every step, following its description:"];
  const empty: string[] = [];
  for (const c of stepColumns(project)) {
    if (c.description) lines.push(`- ### ${c.name}: ${c.description}`);
    else empty.push(c.name);
  }
  if (empty.length) lines.push(`Leave these columns empty — never write them: ${empty.join(", ")}.`);
  const linked = stepColumns(project).filter((c) => c.description && c.referenceSource);
  if (linked.length)
    lines.push(
      `Reference source: every item you write in ${linked.map((c) => c.name).join(", ")} (a requirement code, a value…) has its own ### Sources line, the passage it comes from followed by @<column> "<the item, exactly as written in the cell>" — e.g. - DOC#§4.2 "exact quote" @${linked[0].name} "<item>". The tester clicks the item to open that passage.`,
    );
  return lines;
}
