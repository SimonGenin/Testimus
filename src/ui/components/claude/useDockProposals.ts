import { useQueryClient } from "@tanstack/react-query";
import { type Dispatch, type SetStateAction, useState } from "react";
import type { Proposal } from "../../../core/types.ts";
import { execute } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";
import type { ShownProposal, Turn } from "./turns.ts";

const mark = (turns: Turn[], hit: (p: ShownProposal) => boolean, fn: (p: ShownProposal) => ShownProposal) =>
  turns.map((t) => (t.proposals?.some(hit) ? { ...t, proposals: t.proposals.map((p) => (hit(p) ? fn(p) : p)) } : t));

// ponytail: the changes a chat answer proposed — Apply writes through the command that owns the file (chat.apply; a file
// that moved since Claude read it is refused and said, never overwritten), Ignore closes it, Revert is the proposing
// run's (claude.revert), which takes back every change of that run that was applied
export function useDockProposals(setTurns: Dispatch<SetStateAction<Turn[]>>) {
  const client = useQueryClient();
  const [settling, setSettling] = useState<string | null>(null);

  const settle = async (p: Proposal, how: "apply" | "ignore" | "revert") => {
    setSettling(p.id);
    try {
      if (how === "revert") {
        await execute(client, "claude.revert", { runId: p.runId });
        setTurns((all) =>
          mark(
            all,
            (x) => x.runId === p.runId && x.state === "applied",
            (x) => ({ ...x, reverted: true }),
          ),
        );
      } else {
        const done = await execute(client, how === "apply" ? "chat.apply" : "chat.ignore", { id: p.id });
        setTurns((all) =>
          mark(
            all,
            (x) => x.id === p.id,
            () => done,
          ),
        );
      }
    } catch (e) {
      errorToast(e, `Could not ${how} the change to ${p.name}`);
    } finally {
      setSettling(null);
    }
  };

  return { settling, settle };
}
