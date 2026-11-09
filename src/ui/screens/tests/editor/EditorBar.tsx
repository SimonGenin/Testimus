import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Menu, type MenuEntry } from "../../../components/ui/Menu.tsx";
import { SaveState } from "../../../components/ui/SaveState.tsx";
import { type } from "../../../components/ui/type.ts";
import type { AutosaveStatus } from "../../../lib/data/autosave.ts";
import { border, breakpoint, color, size, space, z } from "../../../styles/tokens.stylex.ts";
import { FolderPicker } from "./FolderPicker.tsx";

// the state of the whole test in the bar: Claude's hold wins over any activity, an activity over the last save
function TestSave(p: {
  status: AutosaveStatus | null;
  activity?: string;
  claude?: boolean | string;
  onRetry: () => void;
}) {
  return (
    <SaveState
      live
      status={p.claude ? "claude" : p.status}
      activity={p.claude ? undefined : p.activity}
      onRetry={p.onRetry}
    />
  );
}

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
  key: { color: color.text, whiteSpace: "nowrap" },
  local: { color: color.textMuted },
  grow: { flex: 1 },
});

// the editor's one-line bar: which test, where, what its last edit became, and what can be done with it
export function EditorBar({
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
  analysis,
  onPush,
  editing = false,
}: {
  testKey?: string;
  folder: string;
  folders: string[];
  status: AutosaveStatus | null;
  activity?: string;
  /** Claude's lock: true, or why the bar's gestures wait */
  claude?: boolean | string;
  /** false, or why Push is off */
  pushDisabled: false | string;
  menu: MenuEntry[];
  onFolders: () => void;
  onFolder: (folder: string) => void;
  onRetry: () => void;
  onAsk: () => void;
  /** Claude's analysis of the test against the documents: the pane open, the proposals left to decide */
  analysis?: { open: boolean; count: number; onToggle: () => void };
  onPush: () => void;
  /** Review › Edit: the bar says « Editing », without folder, push or ⋯ (the way back to the review is in the top bar) */
  editing?: boolean;
}) {
  if (editing)
    return (
      <div role="toolbar" aria-label="Editing in Review" {...stylex.props(styles.bar)}>
        <span data-testid="test-key" {...stylex.props(type.code, styles.key, !testKey && styles.local)}>
          {testKey ?? "local"}
        </span>
        <Badge tone="info" icon="text" label="Editing" />
        <TestSave status={status} activity={activity} claude={claude} onRetry={onRetry} />
        <span {...stylex.props(styles.grow)} />
        <Button size="sm" variant="claude-quiet" icon="claude" label="Ask Claude" onClick={onAsk} />
      </div>
    );
  return (
    <div {...stylex.props(styles.bar)}>
      <span data-testid="test-key" {...stylex.props(type.code, styles.key, !testKey && styles.local)}>
        {testKey ?? "local"}
      </span>
      <FolderPicker
        folder={folder}
        folders={folders}
        disabled={claude ? (typeof claude === "string" ? claude : "Claude is working — wait for it to finish") : false}
        onOpen={onFolders}
        onPick={onFolder}
      />
      <TestSave status={status} activity={activity} claude={claude} onRetry={onRetry} />
      <span {...stylex.props(styles.grow)} />
      {analysis && (
        <Button
          size="sm"
          variant="claude-quiet"
          icon="verify"
          label="Analysis"
          count={analysis.count || undefined}
          pressed={analysis.open}
          onClick={analysis.onToggle}
        />
      )}
      <Button size="sm" variant="claude-quiet" icon="claude" label="Ask Claude" onClick={onAsk} />
      <Button size="sm" variant="primary" icon="push" label="Push to Jira" disabled={pushDisabled} onClick={onPush} />
      <Menu
        label="More actions for this test"
        align="end"
        entries={menu}
        trigger={<Button size="sm" variant="quiet" iconOnly icon="more" label="More actions for this test" />}
      />
    </div>
  );
}
