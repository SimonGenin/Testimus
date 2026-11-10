import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { useRunContext } from "../../components/claude/useRunContext.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import { type } from "../../components/ui/type.ts";
import type { Save } from "../../lib/data/autosave.ts";
import { execute, key } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";
import { color } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  hint: { margin: 0, color: color.textMuted },
});

type Shown = CommandOutput<"docs.show">;

const versionOf = (mtime: number | null | undefined) =>
  mtime === undefined ? undefined : mtime === null ? "" : String(mtime);

// ponytail: what the team says about a document (context.md, saved by itself against the version it was read at)
// and the saved contexts Claude reads with it (doc.json contexts): the block's Context shows what a run on this
// document is given, and the saved contexts ticked there are the document's own list; a pending note belongs to the
// project it was typed in (the key carries it)
export function DocContext({ id, shown, disabled }: { id: string; shown: Shown; disabled: boolean }) {
  const client = useQueryClient();
  const [typed, setTyped] = useState<string | null>(null);
  const saveKey = key("docs.show", { id, brief: true });
  const note = typed ?? shown.context ?? "";

  const patch = (next: Partial<Shown>) =>
    client.setQueryData<Shown>(saveKey as unknown as readonly unknown[], (old) => (old ? { ...old, ...next } : old));

  const save: Save<string> = async (context, base) => {
    const out = await execute(
      client,
      "docs.set",
      { id, context, ...(base === undefined ? {} : { ifMtime: base === "" ? null : Number(base) }) },
      { invalidates: [["claude.preview"]] },
      saveKey[0],
    );
    patch({ context, contextMtime: out.contextMtime });
    return versionOf(out.contextMtime);
  };

  const write = async (change: { contexts: string[] } | { context: string }) => {
    try {
      const out = await execute(
        client,
        "docs.set",
        { id, ...change },
        { invalidates: [["docs.list"], ["claude.preview"]], flushFirst: [["docs.show", { id }]] },
      );
      patch({ ...change, contextMtime: out.contextMtime });
      if ("context" in change) setTyped(null);
    } catch (e) {
      errorToast(e, "Could not save the document");
    }
  };
  // ponytail: a note saved as a context asks two writes at once (the list, then the note emptied): one after the
  // other, so the note's version kept here is the last one written
  const queue = useRef<Promise<void>>(Promise.resolve());
  const set = (change: Parameters<typeof write>[0]) => {
    queue.current = queue.current.then(() => write(change));
    return queue.current;
  };

  const given = useRunContext({
    use: "ask-doc",
    scope: { kind: "doc", docId: id },
    note,
    standing: { says: "every run on this document", onChange: (contexts) => set({ contexts }) },
    onSaved: () => void set({ context: "" }),
  });

  return (
    <>
      <ClaudeBlock
        plain
        submit="autosave"
        value={shown.context ?? ""}
        onChange={setTyped}
        save={save}
        saveKey={saveKey}
        base={versionOf(shown.contextMtime)}
        ariaLabel="Note for this document"
        placeholder="Anything Claude should know about this document…"
        disabled={disabled}
        context={given.context}
      />
      {given.dialog}
      <p {...stylex.props(type.small, styles.hint)}>
        What the team knows about this document. Claude reads it in every run on this document.
      </p>
    </>
  );
}
