import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import type { CommandOutput } from "../../core/commands/index.ts";
import type { Screen } from "./app.ts";
import { execute, useRead } from "./data/query.ts";
import { desktop } from "./desktop.ts";
import { errorToast, jobToast } from "./toast.ts";

export type Updates = CommandOutput<"system.updates">;

const RECHECK_MS = 60 * 60_000;

// ponytail: the update folder is read when the page starts and again when the window comes back after an hour, so a
// Testimus left open all week still hears of a new version; a folder that cannot be read is a state, never an error
export function useUpdates(enabled = true) {
  const q = useRead("system.updates", {}, { enabled });
  const { refetch, isFetching } = q;
  const asked = Math.max(q.dataUpdatedAt, q.errorUpdatedAt);
  useEffect(() => {
    if (!enabled || isFetching) return;
    const back = () => {
      if (document.visibilityState === "visible" && Date.now() - asked > RECHECK_MS) void refetch();
    };
    window.addEventListener("focus", back);
    document.addEventListener("visibilitychange", back);
    return () => {
      window.removeEventListener("focus", back);
      document.removeEventListener("visibilitychange", back);
    };
  }, [enabled, isFetching, refetch, asked]);
  return q;
}

export function useStartUpdate(navigate: (screen: Screen, arg?: string) => void) {
  const client = useQueryClient();
  return async (version?: string): Promise<boolean> => {
    try {
      const r = await execute(client, "system.update", version ? { version } : {}, { invalidates: "none" });
      jobToast(
        `Installing Testimus${version ? ` ${version}` : ""}`,
        r.jobId,
        navigate,
        "It installs beside this version; you can keep working.",
      );
      return true;
    } catch (e) {
      errorToast(e, "Could not start the update");
      return false;
    }
  };
}

export const canRestart = (): boolean => !!desktop();

export function restartApp(): void {
  desktop()
    ?.relaunch()
    .catch((e) => errorToast(e, "Could not restart Testimus"));
}

export const restartHint = (version: string): string =>
  canRestart()
    ? `Restart Testimus to use ${version}.`
    : `Close Testimus and start it again (Start menu, or testimus serve) to use ${version}.`;
