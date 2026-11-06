import type { Step, StepImage, XrayField } from "../../types.ts";
import { imageRef, mapRefs } from "../test-blocks.ts";

export type RawCustom = { id: string; name?: string; value?: unknown };
export type RawAttachment = { id: string; filename?: string; downloadLink?: string };
export type RawStep = {
  id: string;
  action?: string | null;
  data?: string | null;
  result?: string | null;
  customFields?: RawCustom[];
  attachments?: RawAttachment[];
};
export type ReadImage = (file: string) => Promise<Uint8Array>;

const ATTACHMENT_MARKER = /!xray-attachment:\/\/([^!\n|]+)(?:\|([^!\n]*))?!/g;

// The three step fields Xray builds in, under the name test.md gives them and the key the API uses.
// getProjectSettings lists them lowercase (action/data/result), everything else is custom.
export const BUILTIN = [
  { name: "Action", key: "action" },
  { name: "Data", key: "data" },
  { name: "Expected Result", key: "result" },
] as const;
export type BuiltinKey = (typeof BUILTIN)[number]["key"];

// ponytail: Xray refuses a step without an action, and an empty action is legitimate here — so it goes
// up holding one zero-width space, and is stripped again on the way back so the local file stays empty
export const BLANK = "​";
export const orBlank = (text: string) => (text.trim() ? text : BLANK);

export const base = (file: string) => file.split(/[\\/]/).pop() || file;
export const safeName = (s: string) => (s || "image.png").replace(/[^A-Za-z0-9._-]+/g, "_");

export const toRefs = (text: string, images: StepImage[]) =>
  (text ?? "").replace(/\r\n?/g, "\n").replace(ATTACHMENT_MARKER, (m, id: string, params?: string) => {
    const im = images.find((x) => x.remoteId === id);
    return im && !params?.includes('"') ? imageRef(im.file, params ?? "") : m;
  });

export const toMarkers = (text: string, ids: Map<string, string>) =>
  mapRefs(text, (file, params, ref) => {
    const id = ids.get(file);
    return id === undefined ? ref : id ? `!xray-attachment://${id}${params ? `|${params}` : ""}!` : "";
  });

export const fieldOf = (s: Step, name: string) => s.fields[name] ?? "";

// ponytail: a step field switched off in Xray is never sent — Xray refuses a step whose disabled field holds a value;
// what a step holds in it stays in test.md (pull keeps it, the push plan says so)
export const offInXray = (schema: XrayField[], name: string) => !!schema.find((f) => f.name === name)?.disabled;

// ponytail: a built-in field's text as it goes up — empty while the field is switched off in Xray
export const sent = (s: Step, schema: XrayField[], name: string) => (offInXray(schema, name) ? "" : fieldOf(s, name));

export const refsIn = (s: Step, schema: XrayField[] = []) => {
  const files: string[] = [];
  mapRefs(BUILTIN.map((b) => sent(s, schema, b.name)).join("\n"), (file) => {
    files.push(file);
    return "";
  });
  return files.filter((f) => s.images.some((im) => im.file === f));
};

export const byId = (text: string, images: StepImage[]) =>
  mapRefs(text, (file, params) => imageRef(images.find((im) => im.file === file)?.remoteId ?? file, params));

export const knownIds = (s: Step) => new Map(s.images.map((im) => [im.file, im.remoteId ?? ""]));

// Custom step fields, read and written (verified read-only on LFRPS12-327, 2026-11-02):
// read `customFields { id name value }` (value is a JSON scalar), write `customFields: [{ id, value }]`
// in CreateStepInput / UpdateStepInput. This pair of functions is the only place that knows the shape.

// ponytail: a value Xray holds as something other than text (a toggle, a number, a multi-select) is kept as its JSON
// spelling and goes back parsed (customValue), so a rebuild of the step cannot turn it into a string (Xray Editor)
const customText = (v: unknown): string => (v == null ? "" : typeof v === "string" ? v : JSON.stringify(v));

const customValue = (f: XrayField, text: string): unknown => {
  if (f.type === "text" || f.type === "text-single" || !text) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export function readCustom(list: RawCustom[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of list ?? []) {
    // ponytail: a value Xray gives without its column's name is left out, as Xray Editor does (customOf)
    if (!c.name) continue;
    const v = customText(c.value).replace(/\r\n?/g, "\n");
    if (v) out[c.name] = v;
  }
  return out;
}

export function customInput(
  s: Step,
  schema: XrayField[],
  only?: (name: string) => boolean,
): Array<{ id: string; value: unknown }> {
  return schema
    .filter((f) => !f.builtin && !f.disabled && (only ? only(f.name) : !!fieldOf(s, f.name)))
    .map((f) => ({ id: f.id, value: customValue(f, fieldOf(s, f.name)) }));
}

export function readStep(s: RawStep, onImage: (a: RawAttachment, filename: string) => void): Step {
  const images: StepImage[] = (s.attachments ?? []).map((a) => {
    const filename = safeName(a.filename ?? a.id);
    onImage(a, filename);
    // ponytail: the placeholder is keyed by the attachment id — Jira holds five "image.png" in one step
    return { file: `images/${a.id}-${filename}`, remoteId: a.id };
  });
  const builtin: Record<BuiltinKey, string> = {
    action: toRefs((s.action ?? "").split(BLANK).join(""), images),
    data: toRefs(s.data ?? "", images),
    result: toRefs(s.result ?? "", images),
  };
  const fields: Record<string, string> = {};
  for (const b of BUILTIN) fields[b.name] = builtin[b.key];
  Object.assign(fields, readCustom(s.customFields));
  return { id: s.id, fields, sources: [], images };
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

export const mimeOf = (file: string) =>
  MIME[/\.([A-Za-z0-9]+)$/.exec(file)?.[1].toLowerCase() ?? ""] ?? "application/octet-stream";

export async function attachmentInput(file: string, read: ReadImage) {
  const filename = base(file);
  const bytes = await read(file).catch(() => {
    throw new Error(`${file} is missing from the test folder — remove it from the step or add the screenshot again.`);
  });
  return { filename, mimeType: mimeOf(filename), data: Buffer.from(bytes).toString("base64") };
}

export const stepInput = async (s: Step, read: ReadImage, schema: XrayField[]) => {
  const none = new Map(s.images.map((im) => [im.file, ""]));
  const action = toMarkers(sent(s, schema, "Action"), none);
  const custom = customInput(s, schema);
  return {
    action: action.trim() ? action : orBlank(sent(s, schema, "Action")),
    data: toMarkers(sent(s, schema, "Data"), none),
    result: toMarkers(sent(s, schema, "Expected Result"), none),
    attachments: await Promise.all(s.images.map((im) => attachmentInput(im.file, read))),
    ...(custom.length ? { customFields: custom } : {}),
  };
};

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

// ponytail: images only appended keep the ones already in Jira; any other change sends them all again
export function imageOps(local: StepImage[], remote: StepImage[]) {
  const remoteIds = remote.map((im) => im.remoteId ?? "");
  const kept = local.flatMap((im) => (im.remoteId ? [im.remoteId] : []));
  const lastKnown = local.map((im) => !!im.remoteId).lastIndexOf(true);
  const appended = !local.some((im, i) => !im.remoteId && i < lastKnown);
  const ordered = same(
    remoteIds.filter((id) => kept.includes(id)),
    kept,
  );
  if (appended && ordered)
    return { add: local.filter((im) => !im.remoteId), removeIds: remoteIds.filter((id) => !kept.includes(id)) };
  return { add: local, removeIds: remoteIds };
}
