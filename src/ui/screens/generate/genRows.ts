import type { GenTestProgress, LocalTestRef } from "../../../core/types.ts";
import type { Node } from "../../components/tree/tree.ts";

// ponytail: a test of the generation as its tree files it — under its folder (its theme's sub-folder once planned),
// with where Claude is with it while the generation runs
export type GenRow = {
  key: string;
  id?: string;
  summary: string;
  folder: string;
  state: GenTestProgress["state"];
  entry: GenTestProgress;
};

export function writingRows(writing: GenTestProgress[], refs: LocalTestRef[] | undefined): GenRow[] {
  return writing.map((e, k) => {
    const ref = e.id ? refs?.find((r) => r.id === e.id) : undefined;
    return {
      key: e.id ?? `plan:${k + 1}`,
      ...(e.id ? { id: e.id } : {}),
      summary: ref?.summary ?? e.summary ?? (e.state === "writing" ? "A new test" : "Untitled test"),
      folder: ref?.folder || e.folder || "/",
      state: e.state,
      entry: e,
    };
  });
}

export function landedRows(ids: string[], refs: LocalTestRef[] | undefined): GenRow[] {
  return ids.map((id) => {
    const ref = refs?.find((r) => r.id === id);
    return {
      key: id,
      id,
      summary: ref?.summary ?? "Untitled test",
      folder: ref?.folder || "/",
      state: "written",
      entry: { id, state: "written" },
    };
  });
}

// ponytail: how far a folder is — the tests written in it and under it, of all it holds
export function progressOf(n: Node<GenRow>): { written: number; total: number } {
  let written = n.tests.filter((t) => t.state === "written").length;
  for (const f of n.folders) written += progressOf(f).written;
  return { written, total: n.total };
}
