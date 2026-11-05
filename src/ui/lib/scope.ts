import type { DocRef } from "../../core/types.ts";

export type TocEntry = { anchor: string; title: string; level: number };

// a document is in scope whole ("all"), not at all ("none"), or through the sections picked (a section
// takes its sub-sections with it)
export type DocScope = "all" | "none" | string[];
export type Tick = "on" | "off" | "mixed";

export function parents(toc: TocEntry[]): number[] {
  const stack: number[] = [];
  return toc.map((t, i) => {
    while (stack.length && toc[stack[stack.length - 1]].level >= t.level) stack.pop();
    const p = stack.length ? stack[stack.length - 1] : -1;
    stack.push(i);
    return p;
  });
}

function chain(up: number[], i: number): number[] {
  const out: number[] = [];
  for (let p = up[i]; p >= 0; p = up[p]) out.unshift(p);
  return out;
}

const below = (up: number[], i: number, j: number) => {
  for (let p = up[j]; p >= 0; p = up[p]) if (p === i) return true;
  return false;
};

export function tick(toc: TocEntry[], up: number[], picked: string[], i: number): Tick {
  if (picked.includes(toc[i].anchor) || chain(up, i).some((p) => picked.includes(toc[p].anchor))) return "on";
  return toc.some((t, j) => below(up, i, j) && picked.includes(t.anchor)) ? "mixed" : "off";
}

// ponytail: unticking a section that came with a picked ancestor keeps everything else that ancestor gave —
// its other sub-sections, level by level down to the one unticked
export function flip(toc: TocEntry[], up: number[], picked: string[], i: number): string[] {
  const a = toc[i].anchor;
  if (tick(toc, up, picked, i) !== "on") {
    const inside = new Set(toc.filter((_, j) => below(up, i, j)).map((t) => t.anchor));
    return [...picked.filter((p) => !inside.has(p)), a];
  }
  if (picked.includes(a)) return picked.filter((p) => p !== a);
  const path = [...chain(up, i), i];
  const top = path.findIndex((p) => picked.includes(toc[p].anchor));
  const keep: string[] = [];
  for (let k = top; k < path.length - 1; k++)
    toc.forEach((t, j) => {
      if (up[j] === path[k] && j !== path[k + 1]) keep.push(t.anchor);
    });
  return [...picked.filter((p) => p !== toc[path[top]].anchor), ...keep];
}

export function scopeOf(scopes: Record<string, DocScope>, ids: string[]): { docs: string[]; sections: string[] } {
  const docs: string[] = [];
  const sections: string[] = [];
  for (const id of ids) {
    const s = scopes[id] ?? "all";
    if (s === "all") docs.push(id);
    else if (Array.isArray(s)) sections.push(...s.map((a) => `${id}#${a}`));
  }
  return { docs, sections };
}

// the document work under way: the documents a conversion is rewriting, and whether an index run is going on
export type DocWork = { converting: string[]; indexing: boolean };
export type Unready = "not-converted" | "converting" | "indexing" | "not-indexed";

// ponytail: a document search cannot read yet is shown but never in scope — its choice is kept for when it is ready; a
// stale one stays (search still finds its previous version) unless an index run is rewriting it
export function unready(d: Pick<DocRef, "id" | "converted" | "indexed">, w: DocWork): Unready | null {
  if (w.converting.includes(d.id)) return "converting";
  if (!d.converted?.at) return "not-converted";
  if (d.indexed === "fresh") return null;
  if (w.indexing) return "indexing";
  return d.indexed === "missing" ? "not-indexed" : null;
}
