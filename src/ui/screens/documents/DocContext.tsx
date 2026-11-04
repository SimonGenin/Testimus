import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { ContextsDialog } from "../../components/claude/ContextsDialog.tsx";
import { SaveContext } from "../../components/claude/SaveContext.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import { Menu, type MenuEntry } from "../../components/ui/Menu.tsx";
import { type } from "../../components/ui/type.ts";
import type { Save } from "../../lib/data/autosave.ts";
import { execute, key, useRead } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";
import { color } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  hint: { margin: 0, color: color.textMuted },
});

type Shown = CommandOutput<"docs.show">;

const versionOf = (mtime: number | null | undefined) =>
  mtime === undefined ? undefined : mtime === null ? "" : String(mtime);

// ponytail: what the team says about a document (context.md, saved by itself against the version it was read at)
// and the saved contexts Claude reads with it (doc.json contexts: a chip removes one, « + » adds one, as in Generate);
// a pending note belongs to the project it was typed in (the key carries it)
export function DocContext({ id, shown, disabled }: { id: string; shown: Shown; disabled: boolean }) {
  const client = useQueryClient();
  const all = useRead("contexts.list", {});
  const [dialog, setDialog] = useState<"save" | "manage" | null>(null);
  const [typed, setTyped] = useState<string | null>(null);
  const saveKey = key("docs.show", { id, brief: true });
  const ids = shown.contexts ?? [];
  const note = typed ?? shown.context ?? "";

  const patch = (next: Partial<Shown>) =>
    client.setQueryData<Shown>(saveKey as unknown as readonly unknown[], (old) => (old ? { ...old, ...next } : old));

  const save: Save<string> = async (context, base) => {
    const out = await execute(
      client,
      "docs.set",
      { id, context, ...(base === undefined ? {} : { ifMtime: base === "" ? null : Number(base) }) },
      { invalidates: "none" },
      saveKey[0],
    );
    patch({ context, contextMtime: out.contextMtime });
    return versionOf(out.contextMtime);
  };

  const setContexts = async (contexts: string[], context?: string) => {
    try {
      const out = await execute(
        client,
        "docs.set",
        { id, contexts, ...(context === undefined ? {} : { context }) },
        { invalidates: [["docs.list"]], flushFirst: [["docs.show", { id }]] },
      );
      patch({ contexts, contextMtime: out.contextMtime, ...(context === undefined ? {} : { context }) });
      if (context !== undefined) setTyped(null);
    } catch (e) {
      errorToast(e, "Could not save the document");
    }
  };

  const names = all.data ?? [];
  const add: MenuEntry[] = [
    ...names
      .filter((c) => !ids.includes(c.id))
      .map((c) => ({
        label: c.name || c.id,
        icon: "context" as const,
        hint: c.shared ? "shared" : undefined,
        onSelect: () => void setContexts([...ids, c.id]),
      })),
    ...(names.length ? (["separator"] as MenuEntry[]) : []),
    {
      label: "Save the note as a context…",
      disabled: note.trim() ? false : "Write a note first",
      onSelect: () => setDialog("save"),
    },
    { label: "Manage contexts…", onSelect: () => setDialog("manage") },
  ];
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
        contexts={ids.map((c) => ({ id: c, label: names.find((n) => n.id === c)?.name ?? c, on: true }))}
        onRemoveContext={(c) => void setContexts(ids.filter((x) => x !== c))}
        addContext={
          <Menu
            label="Add context"
            entries={add}
            trigger={<Button size="sm" variant="quiet" icon="plus" iconOnly label="Add context" disabled={disabled} />}
          />
        }
      />
      <p {...stylex.props(type.small, styles.hint)}>
        What the team knows about this document. Claude reads it in every run on this document.
      </p>
      {dialog === "save" && (
        <SaveContext
          note={note}
          onSaved={(cid) => void setContexts([...ids, cid], "")}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "manage" && <ContextsDialog onClose={() => setDialog(null)} />}
    </>
  );
}
