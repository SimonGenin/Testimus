import { useCallback, useEffect, useState } from "react";
import { call } from "../../api.ts";
import { cx } from "../../lib/format.ts";
import { Button, Chip } from "../ui/index.ts";
import { CONTEXTS_EVENT, type ContextSummary, ContextsDialog } from "./ContextsDialog.tsx";
import { ImportContexts } from "./ImportContexts.tsx";
import { SaveContext } from "./SaveContext.tsx";

// ponytail: every Claude run takes the same extra context — saved contexts (pointed at) and a note (said in
// full); the list and the note belong to the caller, for one run or for what it is about (`of`)
export function AdditionalContext({
  id,
  ids,
  note,
  of = "this run",
  compact,
  disabled,
  onIds,
  onNote,
  onNoteBlur,
}: {
  id: string;
  ids: string[];
  note: string;
  of?: string;
  compact?: boolean;
  disabled?: boolean;
  onIds: (ids: string[]) => void;
  onNote: (note: string) => void;
  onNoteBlur?: () => void;
}) {
  const [all, setAll] = useState<ContextSummary[]>([]);
  const [dialog, setDialog] = useState<"import" | "save" | "manage" | null>(null);
  const [writing, setWriting] = useState(false);
  const load = useCallback(() => {
    call<ContextSummary[]>("contexts.list", {})
      .then((l) => setAll(l ?? []))
      .catch(() => setAll([]));
  }, []);
  useEffect(() => {
    load();
    window.addEventListener(CONTEXTS_EVENT, load);
    return () => window.removeEventListener(CONTEXTS_EVENT, load);
  }, [load]);

  const known = ids.filter((x) => all.some((c) => c.id === x) || !all.length);
  const showNote = !compact || writing || !!note.trim();
  return (
    <div className={cx("addctx", compact && "addctx-compact")}>
      {known.length > 0 && (
        <div className="chips addctx-chips">
          {known.map((x) => {
            const c = all.find((cc) => cc.id === x);
            return (
              <Chip
                key={x}
                small={compact}
                icon="text"
                title={c?.shared ? "Shared with every project" : undefined}
                onRemove={disabled ? undefined : () => onIds(known.filter((y) => y !== x))}
                removeLabel={`Leave ${c?.name ?? x} out of ${of}`}
              >
                {c?.name ?? x}
                {c?.shared && <span className="tagpill">shared</span>}
              </Chip>
            );
          })}
        </div>
      )}
      {showNote && (
        <>
          <label htmlFor={id} className="sr">
            Note for {of}
          </label>
          <textarea
            id={id}
            className="field addctx-note"
            rows={compact ? 2 : 3}
            placeholder={`Anything Claude should know for ${of}…`}
            value={note}
            disabled={disabled}
            autoFocus={compact && writing && !note}
            onChange={(e) => onNote(e.target.value)}
            onBlur={onNoteBlur}
          />
        </>
      )}
      <div className="addctx-acts">
        <Button size="sm" icon="pull" disabled={disabled} onClick={() => setDialog("import")}>
          {compact ? "Import saved" : "Import saved context"}
        </Button>
        {!showNote && (
          <Button size="sm" tone="quiet" icon="plus" disabled={disabled} onClick={() => setWriting(true)}>
            Add a note
          </Button>
        )}
        {showNote && (
          <button
            type="button"
            className="linkbtn"
            disabled={disabled || !note.trim()}
            title={note.trim() ? undefined : "Write a note first"}
            onClick={() => setDialog("save")}
          >
            Save as context…
          </button>
        )}
      </div>
      {dialog === "import" && (
        <ImportContexts
          all={all}
          picked={ids}
          onUse={onIds}
          onManage={() => setDialog("manage")}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "save" && (
        <SaveContext
          note={note}
          onSaved={(cid) => {
            onIds([...ids, cid]);
            onNote("");
            setWriting(false);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "manage" && <ContextsDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
