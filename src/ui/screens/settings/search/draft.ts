import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../../core/commands/index.ts";
import { execute, useRead } from "../../../lib/data/query.ts";
import { errorToast, toast } from "../../../lib/toast.ts";

export type RetrievalRead = CommandOutput<"rag.retrieval">;
export type Retrieval = RetrievalRead["effective"];
type Key = keyof Retrieval;

const stable = (v: unknown): string =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );

export const same = (a: unknown, b: unknown) => stable(a) === stable(b);

const RANKING: Key[] = ["candidates", "rrfK", "bm25Weights", "rrfWeights", "rerank", "expand"];

// ponytail: Reset ranking keeps the French forms column, which the Words card sets (bm25Weights[3])
function rankingOf(base: Retrieval, value: Retrieval): Partial<Retrieval> {
  const words = base.bm25Weights.slice(0, 3);
  const bm25Weights = value.bm25Weights[3] === 0 ? [...words, 0] : words;
  return { ...Object.fromEntries(RANKING.map((k) => [k, base[k]])), bm25Weights };
}

// ponytail: what Save sends — only what the draft changed from what is saved, and the keys Reset ranking gave back
// to the defaults and this PC's pack that project.json still holds; the core writes them over project.json, so a key
// a colleague set (or that this PC's pack happens to match) is never rewritten
function changesOf(read: RetrievalRead, draft: Retrieval, resets: Key[]) {
  const unset = resets.filter((k) => read.project && k in read.project && same(draft[k], read.base[k]));
  const retrieval: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft) as [Key, unknown][]) {
    if (unset.includes(k) || same(v, read.effective[k])) continue;
    retrieval[k] =
      k === "rerank"
        ? Object.fromEntries(
            Object.entries(draft.rerank).filter(
              ([sub, x]) => !same(x, read.effective.rerank[sub as keyof Retrieval["rerank"]]),
            ),
          )
        : v;
  }
  return { retrieval, unset };
}

// ponytail: the settings being edited — Try it and Measure run with them before they are kept; Save writes them to
// project.json (rag.setRetrieval), Discard goes back to what is saved, Reset ranking to the defaults and the pack's
export function useRetrievalDraft() {
  const client = useQueryClient();
  const read = useRead("rag.retrieval", {});
  const [draft, setDraft] = useState<Retrieval | null>(null);
  const [resets, setResets] = useState<Key[]>([]);
  const [saving, setSaving] = useState(false);
  const saved = read.data?.effective ?? null;
  const value = draft ?? saved;
  const changes = read.data && draft ? changesOf(read.data, draft, resets) : null;
  const dirty = !!changes && (Object.keys(changes.retrieval).length > 0 || changes.unset.length > 0);
  const change = (patch: Partial<Retrieval>) => {
    if (!value) return;
    setDraft({ ...value, ...patch });
    setResets((r) => r.filter((k) => !(k in patch)));
  };
  const reset = () => {
    if (!read.data || !value) return;
    setDraft({ ...value, ...rankingOf(read.data.base, value) });
    setResets(RANKING);
  };
  const discard = () => {
    setDraft(null);
    setResets([]);
  };
  const save = async () => {
    if (!changes) return;
    setSaving(true);
    try {
      await execute(client, "rag.setRetrieval", changes, {
        invalidates: [["rag.retrieval"], ["project.info"], ["rag.search"]],
      });
      discard();
      toast({ tone: "success", title: "Search settings saved", detail: "In project.json, shared with the team." });
    } catch (e) {
      errorToast(e, "Could not save the search settings");
    } finally {
      setSaving(false);
    }
  };
  return { read, value, dirty, saving, change, reset, discard, save };
}

export type Draft = ReturnType<typeof useRetrievalDraft>;
