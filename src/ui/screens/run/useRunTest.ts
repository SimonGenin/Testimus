import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandInput } from "../../../core/commands/index.ts";
import { execute, key } from "../../lib/data/query.ts";
import { toBase64 } from "../../lib/files.ts";
import { errorToast } from "../../lib/toast.ts";
import type { RunResult, RunView } from "./runs.ts";

type Comment = Omit<CommandInput<"runs.comment">, "run" | "test">;

// ponytail: every change a tester makes on a test is written at once (the files are the state); the run's read takes
// the result the command wrote, the list of runs is read again
export function useRunTest(run: string, test: string) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const put = (result: RunResult) =>
    client.setQueryData<RunView>(key("runs.show", { run }) as unknown as readonly unknown[], (old) =>
      old ? { ...old, tests: old.tests.map((t) => (t.id === test ? { ...t, result } : t)) } : old,
    );
  const effects = { invalidates: [["runs.list"], ["runs.history"]] as [string][] };

  const setResult = async (input: Omit<CommandInput<"runs.setResult">, "run" | "test">) => {
    const out = await execute(client, "runs.setResult", { run, test, ...input }, effects);
    put(out.result);
    return out.result;
  };

  return {
    busy,
    mark: (step: number, ok: boolean | null, note?: string) =>
      setResult({ steps: [{ step, ok, ...(note !== undefined ? { note } : {}) }] }).catch((e) =>
        errorToast(e, "The mark was not saved"),
      ),
    marks: (steps: { step: number; ok: boolean }[]) =>
      setResult({ steps }).catch((e) => errorToast(e, "The marks were not saved")),
    unshot: async (file: string) => {
      try {
        const out = await execute(client, "runs.detach", { run, test, file }, effects);
        put(out.result);
      } catch (e) {
        errorToast(e, "The screenshot was not taken off");
      }
    },
    note: (step: number, ok: boolean | null, note: string) =>
      setResult({ steps: [{ step, ok, note }] }).catch((e) => errorToast(e, "The note was not saved")),
    save: async (input: Omit<CommandInput<"runs.setResult">, "run" | "test">) => {
      setBusy(true);
      try {
        await setResult(input);
        return true;
      } catch (e) {
        errorToast(e, "The result was not saved");
        return false;
      } finally {
        setBusy(false);
      }
    },
    comment: async (c: Comment) => {
      try {
        const out = await execute(client, "runs.comment", { run, test, ...c }, effects);
        put(out.result);
      } catch (e) {
        errorToast(e, "The comment was not added");
        throw e;
      }
    },
    shot: async (files: File[], step?: number) => {
      for (const f of files)
        try {
          const out = await execute(
            client,
            "runs.attach",
            { run, test, dataBase64: await toBase64(f), name: f.name, ...(step ? { step } : {}) },
            effects,
          );
          put(out.result);
        } catch (e) {
          errorToast(e, "The screenshot was not added");
        }
    },
  };
}
