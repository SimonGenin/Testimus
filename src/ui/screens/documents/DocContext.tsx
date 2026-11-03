import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { ContextsDialog } from "../../components/claude/ContextsDialog.tsx";
import { ImportContexts } from "../../components/claude/ImportContexts.tsx";
import { SaveContext } from "../../components/claude/SaveContext.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { ClaudeBlock } from "../../components/ui/ClaudeBlock.tsx";
import type { Save } from "../../lib/data/autosave.ts";
import { execute, key, useRead } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";
import { color, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  acts: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  hint: { margin: 0, fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textMuted },
});

type Shown = CommandOutput<"docs.show">;

const versionOf = (mtime: number | null | undefined) =>
  mtime === undefined ? undefined : mtime === null ? "" : String(mtime);

// ponytail: what the team says about a document (context.md, saved by itself against the version it was read at)
// and the saved contexts Claude reads with it (doc.json contexts)
export function DocContext({ id, shown, disabled }: { id: string; shown: Shown; disabled: boolean }) {
  const client = useQueryClient();
  const all = useRead("contexts.list", {});
  const [dialog, setDialog] = useState<"import" | "save" | "manage" | null>(null);
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
        contexts={
          ids.length
            ? ids.map((c) => ({ id: c, label: names.find((n) => n.id === c)?.name ?? c, on: true }))
            : undefined
        }
        onContext={(c, on) => {
          if (!on) void setContexts(ids.filter((x) => x !== c));
        }}
      />
      <p {...stylex.props(styles.hint)}>
        What the team knows about this document. Claude reads it in every run on this document.
      </p>
      <div {...stylex.props(styles.acts)}>
        <Button
          size="sm"
          variant="quiet"
          icon="context"
          label="Use a saved context…"
          disabled={disabled}
          onClick={() => setDialog("import")}
        />
        <Button
          size="sm"
          variant="quiet"
          label="Save as context…"
          disabled={disabled ? true : note.trim() ? false : "Write a note first"}
          onClick={() => setDialog("save")}
        />
      </div>
      {dialog === "import" && (
        <ImportContexts
          all={names}
          picked={ids}
          onUse={(next) => void setContexts(next)}
          onManage={() => setDialog("manage")}
          onClose={() => setDialog(null)}
        />
      )}
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
