import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { CommandInput, CommandName } from "../../../core/commands/index.ts";
import { execute, key, type Prefix, useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";

export type ContextSummary = {
  id: string;
  name: string;
  paths: string[];
  files: string[];
  hasNotes: boolean;
  shared?: boolean;
};
export type ContextDetail = ContextSummary & { notes: string; mtime?: number };

export const CONTEXT_READS: Prefix[] = [
  ["contexts.list"],
  ["contexts.ofTest"],
  ["contexts.ofProject"],
  ["project.info"],
  ["claude.preview"],
];

export function contextLine(c: Pick<ContextSummary, "files" | "paths" | "hasNotes">): string {
  const parts = [
    c.files.length ? plural(c.files.length, "file") : "",
    c.paths.length ? plural(c.paths.length, "path") : "",
    c.hasNotes ? "notes" : "",
  ].filter(Boolean);
  return parts.join(" · ") || "empty";
}

export function useContexts(enabled = true): ContextSummary[] | undefined {
  const r = useRead("contexts.list", {}, { enabled });
  return r.data === undefined ? undefined : (((r.data as unknown) ?? []) as ContextSummary[]);
}

// ponytail: every write to a context answers with the context as it is now — the cache takes it, the lists read again
export function useContextWrite() {
  const client = useQueryClient();
  return useCallback(
    async <N extends CommandName>(name: N, input: CommandInput<N>): Promise<ContextDetail | null> => {
      const out = (await execute(client, name, input, { invalidates: CONTEXT_READS })) as unknown;
      const d = out && typeof out === "object" && "id" in out ? (out as ContextDetail) : null;
      if (d && "notes" in d) client.setQueryData(key("contexts.show", { id: d.id }), d);
      return d;
    },
    [client],
  );
}
