import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Button } from "../../../components/ui/Button.tsx";
import { Menu, type MenuEntry } from "../../../components/ui/Menu.tsx";
import type { AutosaveStatus } from "../../../lib/data/autosave.ts";
import {
  border,
  breakpoint,
  color,
  fontFamily,
  fontSize,
  lineHeight,
  size,
  space,
  z,
} from "../../../styles/tokens.stylex.ts";
import { FolderPicker } from "./FolderPicker.tsx";
import { SaveStatus } from "./SaveStatus.tsx";

const styles = stylex.create({
  bar: {
    boxSizing: "border-box",
    flex: "none",
    position: "relative",
    zIndex: z.sticky,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s3,
    minHeight: size.row2,
    paddingBlock: { default: 0, [breakpoint.narrow]: space.s2 },
    paddingInlineStart: { default: space.s5, [breakpoint.narrow]: space.s3 },
    paddingInlineEnd: space.s4,
    backgroundColor: color.surface,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
    minWidth: 0,
  },
  key: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    color: color.text,
    whiteSpace: "nowrap",
  },
  local: { color: color.textMuted },
  grow: { flex: 1 },
});

// the editor's one-line bar: which test, where, what its last edit became, and what can be done with it
export function EditorBar({
  lead,
  testKey,
  folder,
  folders,
  status,
  activity,
  claude,
  pushDisabled,
  menu,
  onFolders,
  onFolder,
  onRetry,
  onAsk,
  onPush,
}: {
  lead?: ReactNode;
  testKey?: string;
  folder: string;
  folders: string[];
  status: AutosaveStatus | null;
  activity?: string;
  claude?: boolean;
  /** false, or why Push is off */
  pushDisabled: false | string;
  menu: MenuEntry[];
  onFolders: () => void;
  onFolder: (folder: string) => void;
  onRetry: () => void;
  onAsk: () => void;
  onPush: () => void;
}) {
  return (
    <div {...stylex.props(styles.bar)}>
      {lead}
      <span data-testid="test-key" {...stylex.props(styles.key, !testKey && styles.local)}>
        {testKey ?? "local"}
      </span>
      <FolderPicker
        folder={folder}
        folders={folders}
        disabled={claude ? "Claude is working — wait for it to finish" : false}
        onOpen={onFolders}
        onPick={onFolder}
      />
      <SaveStatus status={status} activity={activity} claude={claude} onRetry={onRetry} />
      <span {...stylex.props(styles.grow)} />
      <Button variant="claude-quiet" icon="claude" label="Ask Claude" onClick={onAsk} />
      <Button variant="primary" icon="push" label="Push to Jira" disabled={pushDisabled} onClick={onPush} />
      <Menu
        label="More actions for this test"
        align="end"
        entries={menu}
        trigger={<Button variant="quiet" iconOnly icon="more" label="More actions for this test" />}
      />
    </div>
  );
}
