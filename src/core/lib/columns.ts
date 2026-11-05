import { join } from "node:path";
import { UserError } from "../command.ts";
import type { ColumnEntry, ColumnModes, ColumnShow, StepColumn, XrayField, XrayJson } from "../types.ts";
import { readJson, readXray, writeJson, writeXray } from "./project.ts";
import { fieldName } from "./testfile.ts";

export const DEFAULT_DESCRIPTIONS: Record<string, string> = {
  Action: "One user action per step, in the imperative, on an object named as the product names it.",
  Data: "The values entered or the object aimed at (a code, a record, a file), only when the action needs them.",
  "Expected Result":
    "Everything the user observes after the action, checkable on the product, in the words of the document.",
};

const SHOWS: readonly ColumnShow[] = ["open", "filled", "collapsed", "hidden"];
const RESERVED = /^(sources|description|attachments|expected|result|step)$/i;

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const columnsFile = (project: string) => join(project, "columns.json");

// ponytail: Data and a field switched off in Xray show only on a step that holds something (Xray Editor's defaults)
export const defaultMode = (name: string, field?: XrayField): ColumnShow =>
  name === "Data" || field?.disabled ? "filled" : "open";

export function readColumns(project: string): ColumnEntry[] {
  const raw = readJson<unknown>(columnsFile(project), []);
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is ColumnEntry => !!e && typeof e === "object" && typeof (e as ColumnEntry).name === "string")
    .map((e) => ({
      name: e.name,
      ...(typeof e.id === "string" && e.id ? { id: e.id } : {}),
      ...(typeof e.description === "string" ? { description: e.description } : {}),
      mode: SHOWS.includes(e.mode) ? e.mode : defaultMode(e.name),
      ...(e.referenceSource === true ? { referenceSource: true } : {}),
    }));
}

export function writeColumns(project: string, entries: ColumnEntry[]): void {
  writeJson(columnsFile(project), entries);
}

type Resolved = { col: StepColumn; entry?: ColumnEntry };

// ponytail: an entry's Xray field — by id, else by name: an entry without id, or with an id Xray no longer has (the
// placeholder ids a project starts with before Xray is read, a field the team re-created)
const fieldFor = (fields: XrayField[], e: ColumnEntry): XrayField | undefined =>
  (e.id ? fields.find((f) => f.id === e.id) : undefined) ?? fields.find((f) => same(f.name, e.name));

// ponytail: the entries of columns.json in their order, each matched to its Xray field (fieldFor), then the Xray
// fields no entry names, in Xray's order
function resolve(x: XrayJson, entries: ColumnEntry[]): Resolved[] {
  const used = new Set<XrayField>();
  const out: Resolved[] = [];
  const view = (field: XrayField | undefined, entry: ColumnEntry | undefined): Resolved => {
    const name = field?.name ?? entry?.name ?? "";
    const builtin = !!field?.builtin;
    const fallback = builtin ? (DEFAULT_DESCRIPTIONS[name] ?? "") : undefined;
    const id = field?.id ?? entry?.id;
    return {
      col: {
        name,
        ...(id ? { id } : {}),
        origin: field ? "xray" : "local",
        builtin,
        status: field
          ? entry?.description === undefined && fallback === undefined
            ? "new"
            : "ok"
          : entry?.id
            ? "gone"
            : "ok",
        description: entry?.description ?? fallback ?? "",
        mode: entry?.mode ?? defaultMode(name, field),
        referenceSource: !!entry?.referenceSource,
      },
      ...(entry ? { entry } : {}),
    };
  };
  for (const e of entries) {
    const field = fieldFor(x.fields, e);
    if (field && used.has(field)) continue;
    if (!field && out.some((r) => same(r.col.name, e.name))) continue;
    if (field) used.add(field);
    out.push(view(field, e));
  }
  for (const f of x.fields) if (!used.has(f)) out.push(view(f, undefined));
  return out;
}

export function stepColumns(
  project: string,
  x: XrayJson = readXray(project),
  entries: ColumnEntry[] = readColumns(project),
): StepColumn[] {
  return resolve(x, entries).map((r) => r.col);
}

export const fieldOrder = (project: string): string[] => stepColumns(project).map((c) => c.name);

// ponytail: the project's modes a test folds by — filled and collapsed; open is the default and hidden is not folding
export function projectFolds(project: string): ColumnModes {
  const out: ColumnModes = {};
  for (const c of stepColumns(project)) if (c.mode === "filled" || c.mode === "collapsed") out[c.name] = c.mode;
  return out;
}

const entryOf = ({ col, entry }: Resolved): ColumnEntry => ({
  name: col.name,
  ...(col.id ? { id: col.id } : {}),
  ...(entry?.description !== undefined ? { description: entry.description } : {}),
  mode: col.mode,
  ...(col.referenceSource ? { referenceSource: true } : {}),
});

// ponytail: every change writes the whole list as it is shown, so the order on screen is the order in the file
function saveAll(project: string, all: ColumnEntry[]): StepColumn[] {
  writeColumns(project, all);
  return stepColumns(project, readXray(project), all);
}

function current(project: string): Resolved[] {
  return resolve(readXray(project), readColumns(project));
}

function checkName(columns: StepColumn[], name: string): void {
  if (!name) throw new UserError("A column needs a name.", "E.g. « Remarque testeur ».");
  if (/[\r\n#]/.test(name) || name.length > 60)
    throw new UserError(`« ${name} » cannot be a column name.`, "One line, at most 60 characters, no #.");
  if (RESERVED.test(name) || fieldName(name) !== name)
    throw new UserError(`« ${name} » is a section of test.md, not a column.`, "Choose another name.");
  if (columns.some((c) => same(c.name, name)))
    throw new UserError(`The column « ${name} » already exists.`, "columns.list shows them.");
}

// ponytail: what the input leaves out is kept — a description saved alone keeps the column's Reference source
export function saveColumn(
  project: string,
  input: { name: string; description?: string; referenceSource?: boolean },
): StepColumn[] {
  const name = input.name.trim();
  const now = current(project);
  const at = now.findIndex((r) => same(r.col.name, name));
  const all = now.map(entryOf);
  if (at < 0) {
    checkName(
      now.map((r) => r.col),
      name,
    );
    all.push({ name, description: "", mode: "open" });
  }
  const i = at < 0 ? all.length - 1 : at;
  if (input.description !== undefined) all[i] = { ...all[i], description: input.description.trim() };
  if (input.referenceSource === true) all[i] = { ...all[i], referenceSource: true };
  if (input.referenceSource === false) {
    const { referenceSource: _, ...rest } = all[i];
    all[i] = rest;
  }
  return saveAll(project, all);
}

export function removeColumn(project: string, name: string): StepColumn[] {
  const now = current(project);
  const local = now.find((r) => r.col.origin === "local" && same(r.col.name, name));
  if (!local)
    throw new UserError(
      now.some((r) => r.col.origin === "xray" && same(r.col.name, name))
        ? `« ${name} » is a step field of Xray: it can be hidden, not removed.`
        : `No column called « ${name} ».`,
      "columns.list shows the columns.",
    );
  return saveAll(project, now.filter((r) => r !== local).map(entryOf));
}

function known(now: Resolved[], names: string[]): void {
  const unknown = names.filter((n) => !now.some((r) => r.col.name === n));
  if (unknown.length)
    throw new UserError(
      `Not a step column of this project: ${[...new Set(unknown)].join(", ")}.`,
      `Known columns: ${now.map((r) => r.col.name).join(", ")} (testimus xray refreshFields reads Xray's again).`,
    );
}

export function setModes(project: string, modes: Record<string, ColumnShow>): StepColumn[] {
  const now = current(project);
  known(now, Object.keys(modes));
  return saveAll(
    project,
    now.map(entryOf).map((e) => {
      const mode = modes[e.name];
      return mode ? { ...e, mode } : e;
    }),
  );
}

export function setOrder(project: string, names: string[]): StepColumn[] {
  const now = current(project);
  known(now, names);
  const first = [...new Set(names)].map((n) => now.find((r) => r.col.name === n) as Resolved);
  return saveAll(project, [...first, ...now.filter((r) => !first.includes(r))].map(entryOf));
}

// ponytail: Xray is read again — a field renamed there (same id) carries its description and mode to the new name;
// a field Xray dropped stays as a local column so the text the tests hold is never lost; a local column the team
// then created in Xray becomes that field
export function followXray(before: XrayJson, entries: ColumnEntry[], fields: XrayField[]): ColumnEntry[] {
  const next: ColumnEntry[] = entries.map((e) => {
    const field = fieldFor(fields, e);
    return field ? { ...e, name: field.name, id: field.id } : e;
  });
  for (const f of before.fields)
    if (!f.builtin && !fields.some((n) => n.id === f.id) && !next.some((e) => e.id === f.id || same(e.name, f.name)))
      next.push({ name: f.name, id: f.id, mode: defaultMode(f.name, f) });
  return next;
}

// ponytail: reading Xray's step fields writes xray.json, and columns.json only when a column follows a change
export function storeXray(project: string, fields: XrayField[], fetchedAt: string): XrayJson {
  const before = readXray(project);
  const entries = readColumns(project);
  const next = followXray(before, entries, fields);
  const x: XrayJson = { fetchedAt, fields };
  writeXray(project, x);
  if (JSON.stringify(next) !== JSON.stringify(entries)) writeColumns(project, next);
  return x;
}

// ponytail: the smart columns are said in the request, so the generate-tests skill writes a column it has never
// heard of, following its description
export function columnGuidance(project: string): string[] {
  const lines = ["", "Smart columns — write each as ### <column> in every step, following its description:"];
  const empty: string[] = [];
  const columns = stepColumns(project);
  for (const c of columns) {
    if (c.description) lines.push(`- ### ${c.name}: ${c.description}`);
    else empty.push(c.name);
  }
  if (empty.length) lines.push(`Leave these columns empty — never write them: ${empty.join(", ")}.`);
  const linked = columns.filter((c) => c.description && c.referenceSource);
  if (linked.length)
    lines.push(
      `Reference source: every item you write in ${linked.map((c) => c.name).join(", ")} (a requirement code, a value…) has its own ### Sources line, the passage it comes from followed by @<column> "<the item, exactly as written in the cell>" — e.g. - DOC#§4.2 "exact quote" @${linked[0].name} "<item>". The tester clicks the item to open that passage.`,
    );
  return lines;
}
