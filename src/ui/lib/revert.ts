import { ApiError, call } from "../api.ts";

export type Reverted = { reverted: string[] };

export const editedAfterRun = (e: unknown) => e instanceof ApiError && e.code === "edited-after-run";

export const revertRun = (runId: string, force = false) =>
  call<Reverted>("claude.revert", force ? { runId, force: true } : { runId });
