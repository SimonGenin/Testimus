import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UserError } from "../command.ts";
import { REQ_PATTERN } from "../rag/convert.ts";
import type { ProjectJson, Trace, TraceCoverage, TraceItem, TraceScan, TraceUse, TraceView } from "../types.ts";
import { parseCsv } from "./csv.ts";
import { readProject, readXray, writeProject } from "./project.ts";
import { listLocalTests, readTest } from "./store.ts";

export const REQUIREMENT = "requirement";

const BUILTINS = /^(action|data|expected result|expected|result)$/i;

export function compile(patterns: string[]): RegExp {
  const clean = [...new Set(patterns.map((p) => p.trim()).filter(Boolean))];
  if (!clean.length)
    throw new UserError("No pattern given.", "Give at least one regular expression, e.g. \\bALM-\\d+.");
  for (const p of clean) {
    let re: RegExp;
    try {
      re = new RegExp(p);
    } catch (e) {
      throw new UserError(
        `Not a valid pattern: ${p} (${(e as Error).message}).`,
        "Write a JavaScript regular expression.",
      );
    }
    if (re.test("")) throw new UserError(`The pattern ${p} matches empty text.`, "Make it match the id itself.");
  }
  return new RegExp(clean.map((p) => `(?:${p})`).join("|"), "g");
}

function docIds(project: string): string[] {
  const dir = join(project, "docs");
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "doc.md")))
    .map((e) => e.name)
    .sort();
}

const plain = (line: string) =>
  line
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#+\s*/, "")
    .replace(/\*\*?/g, "")
    .replace(/\s+/g, " ")
    .trim();

function around(text: string, at: number, size = 180): string {
  if (text.length <= size) return text;
  const start = Math.max(0, Math.min(at - size / 3, text.length - size));
  return `${start > 0 ? "…" : ""}${text.slice(start, start + size).trim()}${start + size < text.length ? "…" : ""}`;
}

function csvTexts(project: string): Map<string, string> {
  const file = join(project, "requirements", "requirements.csv");
  const out = new Map<string, string>();
  if (!existsSync(file)) return out;
  const t = parseCsv(readFileSync(file, "utf8").replace(/^﻿/, ""));
  const col = (re: RegExp) => t.headers.findIndex((h) => re.test(h.trim()));
  const [ci, ct] = [Math.max(0, col(/^(id|exigence|requirement)$/i)), col(/^(text|texte|objet|libell[ée])$/i)];
  for (const r of t.rows) {
    const id = (r[ci] ?? "").trim();
    if (id) out.set(id, ct >= 0 ? (r[ct] ?? "").trim() : "");
  }
  return out;
}

// ponytail: one pass over every doc.md — headings give the anchor, comment markers are skipped so an id
// counts where the text says it; the first occurrence of an id is its place
export function scanTrace(
  project: string,
  patterns: string[],
  opts: { doc?: string; limit?: number; csv?: boolean } = {},
): TraceScan {
  const re = compile(patterns);
  const first = new Map<string, TraceItem>();
  const docs: TraceScan["docs"] = [];
  let total = 0;
  for (const doc of docIds(project)) {
    if (opts.doc && opts.doc !== doc) continue;
    const seen = new Set<string>();
    let count = 0;
    let anchor = "";
    for (const line of readFileSync(join(project, "docs", doc, "doc.md"), "utf8").split(/\r?\n/)) {
      const sec = line.match(/<!--\s*§\s*(\S+)\s*-->/);
      if (sec) anchor = `§${sec[1]}`;
      const text = plain(line);
      if (!text) continue;
      for (const m of text.matchAll(re)) {
        count++;
        seen.add(m[0]);
        if (!first.has(m[0])) first.set(m[0], { id: m[0], doc, anchor, context: around(text, m.index ?? 0) });
      }
    }
    total += count;
    if (count) docs.push({ doc, count, distinct: seen.size });
  }
  if (opts.csv)
    for (const [id, text] of csvTexts(project)) {
      const known = first.get(id);
      if (known && text) known.context = text;
      else if (!known && !opts.doc) first.set(id, { id, doc: "", anchor: "", context: text });
    }
  const items = [...first.values()].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  return { total, distinct: items.length, docs, items: items.slice(0, opts.limit ?? items.length) };
}

// ponytail: a project from before tracked ids keeps its requirements: the evidence is the settings it already
// has, an Exigence-like Xray column, a requirements.csv, or requirement anchors in its documents
export function detectedTraces(project: string, p: ProjectJson = readProject(project)): Trace[] {
  const column = readXray(project).fields.find((f) => !f.builtin && /exigence|requirement/i.test(f.name))?.name;
  const anchors = () =>
    docIds(project).some((d) => readFileSync(join(project, "docs", d, "doc.md"), "utf8").includes("<!-- req "));
  const evidence =
    !!p.requirementField?.trim() ||
    !!p.requirementPatterns?.length ||
    !!column ||
    existsSync(join(project, "requirements", "requirements.csv")) ||
    anchors();
  if (!evidence) return [];
  return [
    {
      id: REQUIREMENT,
      label: "Requirement",
      patterns: [REQ_PATTERN, ...(p.requirementPatterns ?? [])],
      field: p.requirementField?.trim() || column || "Exigence",
    },
  ];
}

export function projectTraces(project: string): { traces: Trace[]; declared: boolean } {
  const p = readProject(project);
  if (Array.isArray(p.traces)) return { traces: p.traces, declared: true };
  return { traces: detectedTraces(project, p), declared: false };
}

export function traceViews(project: string): TraceView[] {
  const { traces, declared } = projectTraces(project);
  const columns = new Set(readXray(project).fields.map((f) => f.name));
  return traces.map((t) => {
    let scan: TraceScan | null = null;
    try {
      scan = scanTrace(project, t.patterns, { limit: 0 });
    } catch {}
    return {
      ...t,
      origin: declared ? "declared" : "detected",
      column: columns.has(t.field) ? "in-xray" : "local",
      found: scan?.distinct ?? 0,
      docs: scan?.docs.length ?? 0,
    };
  });
}

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "ids";

export function checkTrace(t: Omit<Trace, "id"> & { id?: string }): void {
  if (!t.label.trim()) throw new UserError("The tracked ids need a name.", "E.g. Requirement, Alarm code, Use case.");
  if (!t.field.trim())
    throw new UserError("The tracked ids need a step column.", "Name the Xray step field, e.g. Exigence.");
  if (BUILTINS.test(t.field.trim()))
    throw new UserError(
      `${t.field} is a standard step field.`,
      "Tracked ids go in their own column: name a custom step field.",
    );
  compile(t.patterns);
}

// ponytail: the first save writes what was only detected, so the team's list is from then on exactly
// project.json.traces; the requirement trace also writes the keys the index and the check read
export function saveTrace(project: string, input: Omit<Trace, "id"> & { id?: string }): Trace[] {
  checkTrace(input);
  const p = readProject(project);
  const list = [...projectTraces(project).traces];
  if (input.id && !list.some((t) => t.id === input.id) && input.id !== REQUIREMENT)
    throw new UserError(`No tracked ids called ${input.id}.`, "traces.list shows them.");
  if (list.some((t) => t.id !== input.id && t.field.trim().toLowerCase() === input.field.trim().toLowerCase()))
    throw new UserError(`The column ${input.field} already holds other tracked ids.`, "Choose another step field.");
  let id = input.id ?? slug(input.label);
  if (!input.id) while (list.some((t) => t.id === id)) id = `${id}-2`;
  const trace: Trace = {
    id,
    label: input.label.trim(),
    patterns: [...new Set(input.patterns.map((x) => x.trim()).filter(Boolean))],
    field: input.field.trim(),
    ...(input.ask?.trim() ? { ask: input.ask.trim() } : {}),
  };
  const at = list.findIndex((t) => t.id === id);
  const next = at < 0 ? [...list, trace] : list.map((t) => (t.id === id ? trace : t));
  const out: ProjectJson = { ...p, traces: next };
  if (id === REQUIREMENT) {
    out.requirementField = trace.field;
    const extra = trace.patterns.filter((x) => x !== REQ_PATTERN);
    if (extra.length) out.requirementPatterns = extra;
    else delete out.requirementPatterns;
  }
  writeProject(project, out);
  return next;
}

export function removeTrace(project: string, id: string): Trace[] {
  const p = readProject(project);
  const list = projectTraces(project).traces;
  if (!list.some((t) => t.id === id)) throw new UserError(`No tracked ids called ${id}.`, "traces.list shows them.");
  const next = list.filter((t) => t.id !== id);
  writeProject(project, { ...p, traces: next });
  return next;
}

// ponytail: a step cites an id when its column holds text the patterns match; what is left once the matches
// are taken out (other words between separators) is an id the patterns do not know
export function idsInCell(value: string | undefined, re: RegExp): { ids: string[]; other: string[] } {
  const text = value ?? "";
  const ids = [...new Set([...text.matchAll(re)].map((m) => m[0]))];
  const other = text
    .replace(re, " ")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter((s) => /[\p{L}\p{N}]/u.test(s));
  return { ids, other: [...new Set(other)] };
}

export function traceCoverage(project: string, only?: string): TraceCoverage[] {
  const traces = projectTraces(project).traces.filter((t) => !only || t.id === only);
  if (only && !traces.length) throw new UserError(`No tracked ids called ${only}.`, "traces.list shows them.");
  const tests = listLocalTests(project).flatMap((ref) => {
    try {
      return [{ ref, test: readTest(project, ref.id).test }];
    } catch {
      return [];
    }
  });
  return traces.map((t) => {
    const re = compile(t.patterns);
    const scan = scanTrace(project, t.patterns, { csv: t.id === REQUIREMENT });
    const uses = new Map<string, TraceUse[]>();
    let citing = 0;
    for (const { ref, test } of tests) {
      const at = new Map<string, number[]>();
      test.steps.forEach((s, i) => {
        const value = Object.entries(s.fields).find(([k]) => k.toLowerCase() === t.field.toLowerCase())?.[1];
        const cell = idsInCell(value, re);
        for (const id of [...cell.ids, ...cell.other]) at.set(id, [...(at.get(id) ?? []), i + 1]);
      });
      if (at.size) citing++;
      for (const [id, steps] of at)
        uses.set(id, [...(uses.get(id) ?? []), { test: ref.id, key: ref.key, summary: ref.summary, steps }]);
    }
    const known = new Set(scan.items.map((i) => i.id));
    const items = scan.items.map((i) => ({ ...i, uses: uses.get(i.id) ?? [] }));
    return {
      trace: t.id,
      label: t.label,
      field: t.field,
      total: items.length,
      covered: items.filter((i) => i.uses.length).length,
      tests: citing,
      items,
      unknown: [...uses]
        .filter(([id]) => !known.has(id))
        .map(([id, u]) => ({ id, uses: u }))
        .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true })),
    };
  });
}

export type Scope = { docs: string[]; sections: string[] };

// ponytail: the ids a generation must cover are the ones written in its scope — whole documents, or a
// section with its sub-sections (a §5.6 ref takes §5.6.6); comment markers are skipped as in scanTrace
export function scopeIds(project: string, patterns: string[], scope: Scope): string[] {
  const re = compile(patterns);
  const bySection = new Map<string, string[]>();
  for (const s of scope.sections) {
    const [doc, anchor] = [s.slice(0, s.indexOf("#")), s.slice(s.indexOf("#") + 1)];
    bySection.set(doc, [...(bySection.get(doc) ?? []), anchor]);
  }
  const found = new Set<string>();
  for (const doc of docIds(project)) {
    const whole = scope.docs.includes(doc);
    const anchors = bySection.get(doc) ?? [];
    if (!whole && !anchors.length) continue;
    let anchor = "";
    for (const line of readFileSync(join(project, "docs", doc, "doc.md"), "utf8").split(/\r?\n/)) {
      const sec = line.match(/<!--\s*§\s*(\S+)\s*-->/);
      if (sec) anchor = `§${sec[1]}`;
      if (!whole && !anchors.some((a) => anchor === a || anchor.startsWith(`${a}.`))) continue;
      for (const m of plain(line).matchAll(re)) found.add(m[0]);
    }
  }
  return [...found].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}
