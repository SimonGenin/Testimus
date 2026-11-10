import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandInput, CommandOutput } from "../../../core/commands/index.ts";
import { useApp } from "../../lib/app.ts";
import type { Save } from "../../lib/data/autosave.ts";
import { ApiError, project } from "../../lib/data/client.ts";
import { execute, type Key, key, useRead } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";

export type Info = CommandOutput<"project.info">;
export type ProjectJson = Info["project"];
type Patch = CommandInput<"project.set">;

// ponytail: asked only while a project is open — Settings without one never sends a project command
export function useInfo() {
  return useRead("project.info", {}, { enabled: !!useApp().info });
}

// ponytail: a choice (a select, a switch, a chip) shows at once and is put back when project.set refuses it; a typed
// field goes through its own autosave (projectField)
export function useSetProject() {
  const client = useQueryClient();
  return async (patch: Patch, what: string): Promise<boolean> => {
    try {
      await execute(client, "project.set", patch, {
        optimistic: (c) => {
          const k = key("project.info", {}) as unknown as readonly unknown[];
          const before = c.getQueryData<Info>(k);
          if (before) {
            const claude = { ...before.project.claude, ...patch.claude };
            const project = { ...before.project, ...patch, claude };
            if (patch.video) {
              const { glossary, ...video } = { ...before.project.video, ...patch.video };
              project.video = glossary ? { ...video, glossary } : video;
            }
            c.setQueryData<Info>(k, { ...before, project: project as ProjectJson });
          }
          return () => c.setQueryData(k, before);
        },
      });
      return true;
    } catch (e) {
      errorToast(e, `Could not save ${what}`);
      return false;
    }
  };
}

const EMPTY: Record<"name" | "jiraProject" | "labelPrefix", string> = {
  name: "A project needs a name — the old one stays until you type another.",
  jiraProject: "Type the Jira project key — the old one stays until you do.",
  labelPrefix: "Type a prefix — the old one stays until you do.",
};

// ponytail: one of project.json's text fields, saved by the field itself (400 ms after the last key, on blur, when the
// screen goes) — nothing is sent while it is unchanged; an empty box is refused, so what was typed stays and the field
// says why
export function useProjectField(
  field: "name" | "jiraProject" | "labelPrefix",
  tidy: (typed: string) => string = (t) => t.trim(),
): { saveKey: Key; save: Save<string>; onChange: (typed: string) => void; error?: string } {
  const client = useQueryClient();
  const [empty, setEmpty] = useState(false);
  const saveKey: Key = [project(), "project.info", { field }];
  const save: Save<string> = async (typed) => {
    const value = tidy(typed);
    if (!value) throw new ApiError(EMPTY[field]);
    const now = client.getQueryData<Info>(key("project.info", {}) as unknown as readonly unknown[]);
    if (value === now?.project[field]) return;
    await execute(client, "project.set", { [field]: value }, {}, saveKey[0]);
  };
  return {
    saveKey,
    save,
    onChange: (typed) => setEmpty(!tidy(typed)),
    ...(empty ? { error: EMPTY[field] } : {}),
  };
}
