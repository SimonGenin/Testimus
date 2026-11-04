import type { Test } from "../../../../core/types.ts";
import type { MenuEntry } from "../../../components/ui/Menu.tsx";
import type { AutosaveStatus } from "../../../lib/data/autosave.ts";
import { lossOf } from "../../../lib/diff.ts";
import type { EditorActions } from "./useEditorActions.ts";

// why Push to Jira is off, or false — Claude first, then an edit that is not written, then Jira, then the open plan,
// then nothing to send
export function pushReason(o: {
  /** Claude's lock: true, or its reason */
  busy: boolean | string;
  jiraOff: boolean;
  pushing: boolean;
  canPush: boolean;
  unsaved?: AutosaveStatus;
}): false | string {
  if (o.busy) return typeof o.busy === "string" ? o.busy : "Claude is working — wait for it to finish";
  if (o.unsaved === "conflict")
    return "Your change is not saved: test.md changed on disk — keep yours or reload it first";
  if (o.unsaved === "error") return "Your last change is not saved — retry the save first";
  if (o.jiraOff) return "Jira is not connected — connect it from the Jira tab of the test list";
  if (o.pushing) return "The push plan is open";
  if (!o.canPush) return "No local change since the last sync — nothing to push";
  return false;
}

// the ⋯ of the editor's bar: what can be done with the test as a whole; Delete last, red, behind its own separator
export function testMenu({
  test,
  remote,
  dirty,
  busyDl,
  locked = false,
  actions,
}: {
  test: Test;
  remote: Test | null;
  dirty: boolean;
  busyDl: boolean;
  /** Claude's lock: why every entry that changes the test waits */
  locked?: false | string;
  actions: EditorActions;
}): MenuEntry[] {
  const key = test.key;
  const loss = remote && dirty ? lossOf(test, remote) : null;
  const steps = loss ? loss.modified + loss.added + loss.deleted : 0;
  return [
    { label: "Clone", icon: "copy", hint: "saves first", disabled: locked, onSelect: () => void actions.clone() },
    ...(key
      ? [
          {
            label: "Download from Jira",
            icon: "download" as const,
            hint: dirty ? "replaces local" : undefined,
            disabled: locked || (busyDl ? "Refreshing from Jira…" : false),
            onSelect: () => void actions.askDownload(),
          },
        ]
      : []),
    ...(remote
      ? [
          {
            label: "Undo local changes",
            icon: "undo" as const,
            hint: steps ? `${steps} changed step${steps === 1 ? "" : "s"}` : undefined,
            disabled: locked || (dirty ? false : "Only while the test differs from Jira"),
            onSelect: () => actions.askUndo(),
          },
        ]
      : []),
    ...(key
      ? [
          {
            label: "Open in Jira",
            icon: "external" as const,
            onSelect: () => void actions.openInJira(key),
          },
        ]
      : []),
    "separator",
    {
      label: "Delete local copy",
      icon: "trash",
      danger: true,
      disabled: locked,
      onSelect: () => void actions.askDelete(),
    },
  ];
}
