import { call } from "../api.ts";
import { message } from "./format.ts";

export type Reverted = { reverted: string[] };

export const editedAfterRun = (e: unknown) => /changed after the Claude run/i.test(message(e));

export const revertRun = (runId: string, force = false) =>
  call<Reverted>("claude.revert", force ? { runId, force: true } : { runId });
