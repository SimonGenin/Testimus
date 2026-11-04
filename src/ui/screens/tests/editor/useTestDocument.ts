import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LocalTestRef, SyncState, Test } from "../../../../core/types.ts";
import { type Autosave, useAutosave } from "../../../lib/data/autosave.ts";
import { execute, key, useRead } from "../../../lib/data/query.ts";

export type TestShow = {
  id: string;
  test: Test;
  warnings?: string[];
  remote?: Test | null;
  sync?: SyncState;
  edited?: boolean;
  files?: string[];
  mtime?: number;
};

// what a change of the test on disk was: the first read, a reload the editor asked for (after a download, an undo, a
// push, a Claude run), or someone else's edit (a terminal, Claude Code, a job)
export type Landing = { first: boolean; expected: unknown };

export type TestDocument = {
  data: TestShow | undefined;
  test: Test | null;
  error: Error | null;
  doc: Autosave<Test>;
  /** edit the whole test; refused while read-only */
  update: (fn: (t: Test) => Test) => void;
  /** the generation of what is on screen: an Undo made for an older one is too late */
  gen: number;
  /** read the test again; what lands is handed to onLanded with this reason */
  reload: (expected?: unknown) => Promise<void>;
  /** read it again as someone else's change */
  recheck: () => Promise<void>;
};

// ponytail: the test editor's document — tests.show read once, edited whole and saved by the data layer's autosave
// (400 ms, blur, unmount; one save in the air; a change on disk under an edit is a conflict), the answer of each save
// put back in the read so the sync badge follows
export function useTestDocument(
  id: string,
  {
    readOnly,
    onSaved,
    onLanded,
  }: {
    readOnly: boolean;
    onSaved?: (ref: Partial<LocalTestRef> & { id: string }) => void;
    onLanded?: (data: TestShow, landing: Landing) => void;
  },
): TestDocument {
  const client = useQueryClient();
  const k = key("tests.show", { id });
  const q = useRead("tests.show", { id });
  const data = q.data as TestShow | undefined;
  const own = useRef(new WeakSet<Test>());
  const ownMtimes = useRef(new Set<number>());
  const seen = useRef<Test | null>(null);
  const seenFor = useRef(id);
  const expected = useRef<unknown>(undefined);
  const [gen, setGen] = useState(0);
  const saved = useRef(onSaved);
  saved.current = onSaved;
  const landed = useRef(onLanded);
  landed.current = onLanded;

  const doc = useAutosave<Test>({
    key: k,
    value: data?.test,
    base: data?.mtime === undefined ? undefined : String(data.mtime),
    readOnly,
    // ponytail: the save carries the version it was made over; the core refuses it (conflict) when test.md moved since —
    // « Keep mine » sends it again without one; it goes to the project the edit was typed in (the key's), even when it
    // leaves after the window moved to another
    save: async (test, base) => {
      const ref = (await execute(
        client,
        "tests.save",
        base ? { id, test, ifMtime: Number(base) } : { id, test },
        { invalidates: [["tests.list"], ["review.queue"], ["xray.plan", { id }], ["search.all"], ["project.info"]] },
        k[0],
      )) as (Partial<LocalTestRef> & { id: string; mtime?: number }) | null;
      own.current.add(test);
      if (ref?.mtime) ownMtimes.current.add(ref.mtime);
      client.setQueryData(k, (old: TestShow | undefined) =>
        old
          ? {
              ...old,
              test,
              ...(ref?.mtime ? { mtime: ref.mtime } : {}),
              ...(ref?.sync ? { sync: ref.sync } : {}),
              edited: !!ref?.edited,
            }
          : old,
      );
      if (ref) saved.current?.(ref);
      return ref?.mtime ? String(ref.mtime) : undefined;
    },
  });

  useEffect(() => {
    const t = data?.test;
    // ponytail: what this editor saved comes back as its own echo — by the object it sent, or by the mtime its save got
    if (!t || t === seen.current || own.current.has(t) || (data?.mtime && ownMtimes.current.has(data.mtime))) {
      if (t) seen.current = t;
      return;
    }
    const first = seen.current === null || seenFor.current !== id;
    seenFor.current = id;
    seen.current = t;
    const why = expected.current;
    expected.current = undefined;
    setGen((g) => g + 1);
    landed.current?.(data, { first, expected: why });
  }, [data, id]);

  const reload = useCallback(
    async (why?: unknown) => {
      expected.current = why ?? "reload";
      const r = await q.refetch();
      if (r.error) {
        expected.current = undefined;
        throw r.error;
      }
      const now = r.data as TestShow | undefined;
      // ponytail: the same test came back (nothing changed on disk) — no render will hand it over, so it is said here
      if (now && now.test === seen.current && expected.current !== undefined) {
        const was = expected.current;
        expected.current = undefined;
        landed.current?.(now, { first: false, expected: was });
      }
    },
    [q],
  );

  // ponytail: someone else may have written test.md (a terminal, Claude Code) — read it again; what lands is theirs
  const recheck = useCallback(async () => {
    const r = await q.refetch();
    if (r.error) throw r.error;
  }, [q]);

  const update = (fn: (t: Test) => Test) => {
    if (readOnly || !data) return;
    doc.set((prev) => fn(prev ?? data.test));
  };

  return {
    data,
    test: doc.value ?? null,
    error: q.error && !data ? q.error : null,
    doc,
    update,
    gen,
    reload,
    recheck,
  };
}
