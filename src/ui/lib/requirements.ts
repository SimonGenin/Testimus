import type { DocRef } from "../../core/types.ts";
import { call, fileUrl } from "../api.ts";

export type Requirement = { id: string; text: string; doc: string };

export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const sep =
    (text.split("\n")[0].match(/;/g)?.length ?? 0) > (text.split("\n")[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

export async function loadRequirements(): Promise<Requirement[]> {
  const out = new Map<string, Requirement>();
  try {
    const res = await fetch(fileUrl("requirements/requirements.csv"));
    if (res.ok) {
      const [head, ...rows] = parseCsvRows((await res.text()).replace(/^﻿/, ""));
      const col = (n: string) => head?.findIndex((h) => h.trim().toLowerCase() === n) ?? -1;
      const [ci, ct, cd] = [col("id"), col("text"), col("doc")];
      if (ci >= 0)
        for (const r of rows) {
          const id = r[ci]?.trim();
          if (id) out.set(id, { id, text: r[ct]?.trim() ?? "", doc: r[cd]?.trim() ?? "" });
        }
    }
  } catch {}
  try {
    const docs = await call<DocRef[]>("docs.list", {});
    for (const d of docs ?? []) {
      const r = await call<{ requirements: string[] }>("docs.show", { id: d.id }).catch(() => null);
      for (const id of r?.requirements ?? []) if (!out.has(id)) out.set(id, { id, text: "", doc: d.id });
    }
  } catch {}
  return [...out.values()].sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}
