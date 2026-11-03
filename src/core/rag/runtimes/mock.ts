import { dimsOf } from "../fingerprint.ts";
import { words } from "../search/lexical.ts";
import type { Runtime } from "./types.ts";

function hashWord(w: string, dims: number): number {
  let h = 2166136261;
  for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
  return (h >>> 0) % dims;
}

function fakeVector(text: string, dims: number): Float32Array {
  const v = new Float32Array(dims);
  for (const w of words(text)) v[hashWord(w, dims)] += 1;
  const n = Math.hypot(...v) || 1;
  for (let i = 0; i < dims; i++) v[i] /= n;
  return v;
}

function fakeRerank(query: string, texts: string[]): number[] {
  const q = new Set(words(query));
  return texts.map((t) => {
    const w = words(t);
    return w.filter((x) => q.has(x)).length / (w.length || 1);
  });
}

export const mockRuntime: Runtime = {
  probe: async (m) => ({ dims: dimsOf(m), maxTokens: m.entry.maxInputTokens }),
  embed: async (m, texts) => texts.map((t) => fakeVector(t, dimsOf(m))),
  rerank: async (_m, query, texts) => fakeRerank(query, texts),
};
