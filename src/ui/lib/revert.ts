import { ApiError } from "../api.ts";
import type { AppState } from "./app.ts";
import { plural } from "./format.ts";
import { toast } from "./toast.ts";

export const editedAfterRun = (e: unknown) => e instanceof ApiError && e.code === "edited-after-run";

// ponytail: a Claude run reverted from anywhere (the dock, the editor, Review) ends the same way — the screens drop
// its marks, the dock marks its card reverted (and says so to Claude next time), one toast says it
export function revertDone(
  app: Pick<AppState, "setLastRun">,
  runId: string,
  r: { reverted?: string[]; files?: string[] },
  tests: string[] = [],
): void {
  const reverted = r.reverted?.length ? r.reverted : tests;
  app.setLastRun({ runId: "", reverted: runId, changedTests: reverted, changedSteps: {}, nonce: Date.now() });
  const files = r.files?.length ? ` and ${plural(r.files.length, "file")}` : "";
  toast({
    tone: "neutral",
    title: "Claude's changes reverted",
    detail: r.reverted ? `${plural(r.reverted.length, "test")}${files} restored.` : undefined,
  });
}
