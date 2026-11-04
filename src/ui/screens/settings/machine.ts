import { useQueryClient } from "@tanstack/react-query";
import type { CommandInput, CommandOutput } from "../../../core/commands/index.ts";
import { execute, key, useRead } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";

export type Settings = CommandOutput<"system.settings">;

export function useSettings() {
  return useRead("system.settings", {});
}

// ponytail: settings.json is this PC's — system.set answers with the whole file, which becomes what the page shows;
// a new claude.exe is asked again by whoever shows Claude's state
export function useSetSettings() {
  const client = useQueryClient();
  return async (patch: CommandInput<"system.set">): Promise<Settings> => {
    const out = await execute(client, "system.set", patch, {
      invalidates: patch.claudeExe === undefined ? [["system.doctor"]] : [["claude.status"], ["system.doctor"]],
    });
    client.setQueryData(key("system.settings", {}) as unknown as readonly unknown[], out);
    return out;
  };
}

export function useSetting() {
  const set = useSetSettings();
  return (patch: CommandInput<"system.set">) =>
    set(patch).catch((e) => {
      errorToast(e, "Could not save the settings");
      return null;
    });
}
