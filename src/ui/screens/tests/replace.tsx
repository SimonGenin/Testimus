import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { Test } from "../../../core/types.ts";
import { useApp } from "../../lib/app.ts";
import { discardAutosave, flushAutosaves } from "../../lib/data/autosave.ts";
import { run } from "../../lib/data/client.ts";
import { invalidate, key, read } from "../../lib/data/query.ts";
import { differs, diffLocal, lossOf } from "../../lib/diff.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { type Loss, ReplaceConfirm } from "./editor/Confirms.tsx";
import { claudeLock } from "./lock.ts";

type PullResult = { pulled?: string[]; failed?: { key: string; error: string }[] };
type Asked = { id: string; key: string; synced: boolean; loss?: Loss; modifiedSteps: number[] };

// ponytail: « replace the local copy with Jira's version » is one gesture wherever it is offered (the editor's
// Download, the list's Pull, Review's choice on a test changed in Jira): the pending edit is saved first, the test is
// read again to know what would be lost, the confirmation asks only when something is, Claude's lock refuses it, the
// pending autosave is dropped, xray.pull overwrites, one toast says it
export function useReplaceWithJira(
  o: {
    /** the editor's own save of the edit on screen (else every pending autosave of the test is sent) */
    save?: () => Promise<unknown>;
    /** after the copy landed, before the toast: the editor reads the file again */
    onReplaced?: (id: string) => void | Promise<void>;
  } = {},
) {
  const app = useApp();
  const client = useQueryClient();
  const [asked, setAsked] = useState<Asked | null>(null);
  const [busy, setBusy] = useState<string[]>([]);

  const replace = async (id: string, k: string) => {
    const lock = claudeLock(app.claudeRunning, id);
    if (lock) throw new Error(lock);
    setBusy((b) => [...b, id]);
    try {
      discardAutosave(key("tests.show", { id }));
      const r = await run<PullResult>("xray.pull", { key: k, overwrite: true });
      const failed = r?.failed?.find((f) => f.key === k) ?? r?.failed?.[0];
      if (failed) throw new Error(failed.error);
      await invalidate(client, [
        ["tests.show", { id }],
        ["check.show", { id }],
        ["tests.list"],
        ["review.queue"],
        ["project.info"],
        ["xray.status"],
        ["search.all"],
      ]);
      app.testsChanged();
      await o.onReplaced?.(id);
      toast({ tone: "success", title: `${k} replaced with Jira's version` });
    } finally {
      setBusy((b) => b.filter((x) => x !== id));
    }
  };

  const ask = async (id: string, k: string) => {
    const lock = claudeLock(app.claudeRunning, id);
    if (lock) return toast({ tone: "neutral", title: "Wait for Claude to finish", detail: lock });
    const unsaved = await (o.save ? o.save() : flushAutosaves([["tests.show", { id }]]));
    let shown: { test: Test; remote?: Test | null };
    try {
      await invalidate(client, [["tests.show", { id }]]);
      shown = (await read(client, "tests.show", { id })) as typeof shown;
    } catch (e) {
      return errorToast(e, "Could not read the test");
    }
    const remote = shown.remote ?? null;
    // ponytail: an edit that could not be saved is a local change the replacement would lose too
    if (!unsaved && remote && !differs(shown.test, remote))
      return void replace(id, k).catch((e) => errorToast(e, `Could not pull ${k}`));
    const diff = remote ? diffLocal(shown.test.steps, remote.steps) : null;
    setAsked({
      id,
      key: k,
      synced: !!remote,
      loss: remote ? lossOf(shown.test, remote) : undefined,
      modifiedSteps: diff?.marks.flatMap((m, i) => (m === "modified" ? [i + 1] : [])) ?? [],
    });
  };

  const dialog = asked && (
    <ReplaceConfirm
      testKey={asked.key}
      synced={asked.synced}
      loss={asked.loss}
      modifiedSteps={asked.modifiedSteps}
      onConfirm={async () => {
        await replace(asked.id, asked.key);
        setAsked(null);
      }}
      onClose={() => setAsked(null)}
    />
  );

  return { ask, busy: (id: string) => busy.includes(id), dialog };
}
