import { useState } from "react";
import { useDraft } from "../../lib/data/autosave.ts";
import { type Key, useRead } from "../../lib/data/query.ts";
import { ContextDialog, type Standing } from "./ContextDialog.tsx";
import { type Asked, changed, countOn, pickOf, type RunPick } from "./pieces.ts";

const NONE: RunPick = {};

// ponytail: the « Context » of a Claude block, the same for every block — what the block's request is given
// (claude.preview), what the user ticked for this run only, the button that says how much goes and whether it was
// changed, and the dialog that shows it all. The pick starts again when the block is about something else (another
// test, another scope: `subject`), or lives with the block's draft (`draftKey`: a generation's request); it is never
// written to the project. With `standing` the block edits a list kept for every run (a document's, a test's): the
// dialog writes that list and nothing is picked per run
export function useRunContext({
  use,
  scope,
  docs,
  sections,
  generation,
  note,
  conversation,
  subject,
  draftKey,
  standing,
  onSaved,
  enabled = true,
}: Asked & {
  /** what is written in the block and the Claude panel's exchanges: shown as the user's own words */
  note?: string;
  conversation?: string;
  /** what the block is about, in any words: another one starts from its own contexts (default: the use and the
   * scope, whatever the step) */
  subject?: string;
  /** keeps the pick with the block's unsent draft, for the life of the page */
  draftKey?: Key;
  standing?: Standing;
  /** the block's text became a saved context: empty the block */
  onSaved?: () => void;
  /** false while there is nothing to ask about (no project open) */
  enabled?: boolean;
}) {
  const asked: Asked = {
    use,
    ...(scope ? { scope } : {}),
    ...(docs?.length ? { docs } : {}),
    ...(sections?.length ? { sections } : {}),
    ...(generation ? { generation } : {}),
  };
  const about = subject ?? JSON.stringify([use, scope && { ...scope, step: undefined }, generation]);
  const [held, setHeld] = useState<{ about: string; pick: RunPick }>({ about, pick: NONE });
  const [drafted, setDrafted] = useDraft(draftKey ?? null);
  const [open, setOpen] = useState(false);
  const pick = standing ? NONE : draftKey ? pickOf(drafted) : held.about === about ? held.pick : NONE;
  const setPick = (next: RunPick) =>
    draftKey ? setDrafted(changed(next) ? JSON.stringify(next) : "") : setHeld({ about, pick: next });
  const read = useRead("claude.preview", { ...asked, ...pick }, { enabled, keepPrevious: true });
  // ponytail: the user's words are counted here, not read: the preview is not asked again at every key typed
  const words = standing ? 0 : (note?.trim() ? 1 : 0) + (conversation?.trim() ? 1 : 0);

  return {
    /** what the run command takes besides its own input: spread it there */
    run: pick,
    /** the kit's control: <ClaudeBlock context={…} /> */
    context: {
      count: read.data ? countOn(read.data.pieces) + words : undefined,
      changed: changed(pick),
      onOpen: () => setOpen(true),
    },
    /** whether the dialog is open (a popover around the block stays open under it) */
    open,
    dialog: open ? (
      <ContextDialog
        asked={asked}
        text={note}
        note={standing ? undefined : note}
        conversation={standing ? undefined : conversation}
        pick={pick}
        onPick={setPick}
        standing={standing}
        onSaved={onSaved}
        onClose={() => setOpen(false)}
      />
    ) : null,
  };
}

export type RunContext = ReturnType<typeof useRunContext>;
