import * as stylex from "@stylexjs/stylex";
import { useRef, useState } from "react";
import { Button } from "../../../components/ui/Button.tsx";
import { List } from "../../../components/ui/List.tsx";
import { Popover } from "../../../components/ui/Popover.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { space } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  box: { display: "flex", flexDirection: "column", gap: space.s2 },
});

// ponytail: the test's Xray folder — the folders Jira has and the project's, filtered as you type; a new path is typed
// whole. Enter, a pick or leaving the picker moves the test; Escape leaves it where it was
export function FolderPicker({
  folder,
  folders,
  disabled,
  onOpen,
  onPick,
}: {
  folder: string;
  folders: string[];
  disabled?: boolean | string;
  onOpen?: () => void;
  onPick: (folder: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(folder);
  const cancelled = useRef(false);
  const needle = draft.trim().toLowerCase();
  const shown = folders.filter((f) => !needle || f.toLowerCase().includes(needle) || draft === folder).slice(0, 50);
  const commit = (v: string) => {
    const next = v.trim() || "/";
    if (next !== folder) onPick(next);
  };
  return (
    <Popover
      title="Move to a folder"
      icon="folder"
      align="start"
      width="sm"
      open={open}
      onOpenChange={(o) => {
        if (o) {
          cancelled.current = false;
          setDraft(folder);
          onOpen?.();
        } else if (!cancelled.current) commit(draft);
        setOpen(o);
      }}
      trigger={
        <Button
          variant="quiet"
          size="sm"
          icon="folder"
          iconAfter="chevron-down"
          label={folder || "/"}
          disabled={disabled}
          data-testid="folder"
        />
      }
    >
      <div {...stylex.props(styles.box)}>
        <Text
          label="Folder"
          value={draft}
          autoFocus
          spellCheck={false}
          placeholder="/Traction/Sectionneurs"
          onChange={setDraft}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancelled.current = true;
            if (e.key === "Enter") {
              e.preventDefault();
              cancelled.current = true;
              commit(draft);
              setOpen(false);
            }
          }}
        />
        {shown.length > 0 && (
          <List
            label="Xray folders"
            items={shown}
            getKey={(f) => f}
            selected={folder}
            renderItem={(f) => ({ title: f })}
            onSelect={(f) => {
              cancelled.current = true;
              commit(f);
              setOpen(false);
            }}
          />
        )}
      </div>
    </Popover>
  );
}
