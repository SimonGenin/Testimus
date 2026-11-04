import { ApiError } from "../api.ts";

export const editedAfterRun = (e: unknown) => e instanceof ApiError && e.code === "edited-after-run";
