import { useState } from "react";
import { contextLabel } from "../../lib/labels.ts";
import { Button } from "../ui/Button.tsx";
import { Menu, type MenuEntry } from "../ui/Menu.tsx";
import { ContextsDialog } from "./ContextsDialog.tsx";
import { useContexts } from "./contexts.ts";
import { SaveContext } from "./SaveContext.tsx";

// ponytail: the « + » of every Claude block that takes contexts — the saved contexts ticked for what the block is
// about, the block's text saved as a new one, the contexts managed; owners differ only in what « on » means
export function ContextMenu({
  isOn,
  onToggle,
  text,
  onSaved,
  disabled,
  foot,
}: {
  isOn: (id: string) => boolean;
  onToggle: (id: string, on: boolean) => void;
  /** what is written in the block: « Save the text as a context… » saves it */
  text: string;
  /** the new context: the owner ticks it and empties the block */
  onSaved: (id: string) => void;
  disabled?: boolean;
  /** under the list: who the ticked contexts go with */
  foot?: string;
}) {
  const all = useContexts() ?? [];
  const [dialog, setDialog] = useState<"save" | "manage" | null>(null);
  const entries: MenuEntry[] = [
    { group: "Saved contexts" },
    ...(all.length
      ? all.map((c) => ({
          label: contextLabel(c),
          icon: "context" as const,
          hint: c.shared ? "shared" : "this project",
          checked: isOn(c.id),
          keepOpen: true,
          onSelect: () => onToggle(c.id, !isOn(c.id)),
        }))
      : [{ note: "No saved context yet — write in the box and save the text as a context." }]),
    "separator",
    {
      label: "Save the text as a context…",
      icon: "plus",
      disabled: text.trim() ? false : "Write in the box first",
      onSelect: () => setDialog("save"),
    },
    { label: "Manage contexts…", icon: "settings", onSelect: () => setDialog("manage") },
    ...(foot ? [{ note: foot }] : []),
  ];
  return (
    <>
      <Menu
        label="Add context"
        trigger={<Button size="sm" variant="quiet" icon="plus" iconOnly label="Add context" disabled={disabled} />}
        entries={entries}
      />
      {dialog === "save" && <SaveContext note={text} onSaved={onSaved} onClose={() => setDialog(null)} />}
      {dialog === "manage" && <ContextsDialog onClose={() => setDialog(null)} />}
    </>
  );
}
