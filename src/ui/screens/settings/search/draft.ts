import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../../core/commands/index.ts";
import { execute, useRead } from "../../../lib/data/query.ts";
import { errorToast, toast } from "../../../lib/toast.ts";

export type RetrievalRead = CommandOutput<"rag.retrieval">;
export type Retrieval = RetrievalRead["effective"];

const stable = (v: unknown): string =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b)))
      : x,
  );

export const same = (a: unknown, b: unknown) => stable(a) === stable(b);

// ponytail: project.json keeps only what differs from the defaults and the pack, so a pack's change still reaches a
// key the team never set
function overOf(base: Retrieval, draft: Retrieval): Partial<Retrieval> {
  return Object.fromEntries(
    Object.entries(draft).filter(([k, v]) => !same(v, base[k as keyof Retrieval])),
  ) as Partial<Retrieval>;
}

// ponytail: the settings being edited — Try it and Measure run with them before they are kept; Save writes them to
// project.json (rag.setRetrieval), Discard goes back to what is saved, Reset to the defaults and the pack's
export function useRetrievalDraft() {
  const client = useQueryClient();
  const read = useRead("rag.retrieval", {});
  const [draft, setDraft] = useState<Retrieval | null>(null);
  const [saving, setSaving] = useState(false);
  const saved = read.data?.effective ?? null;
  const value = draft ?? saved;
  const dirty = !!draft && !!saved && !same(draft, saved);
  const change = (patch: Partial<Retrieval>) => value && setDraft({ ...value, ...patch });
  const reset = () => read.data && setDraft(read.data.base);
  const discard = () => setDraft(null);
  const save = async () => {
    if (!read.data || !draft) return;
    const over = overOf(read.data.base, draft);
    setSaving(true);
    try {
      await execute(
        client,
        "rag.setRetrieval",
        { retrieval: Object.keys(over).length ? over : null },
        { invalidates: [["rag.retrieval"], ["project.info"], ["rag.search"]] },
      );
      setDraft(null);
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
