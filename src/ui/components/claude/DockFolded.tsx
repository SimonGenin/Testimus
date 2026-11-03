import * as stylex from "@stylexjs/stylex";
import { plural } from "../../lib/format.ts";
import { color, fontSize, fontWeight, lineHeight, size, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { Spinner } from "../ui/Spinner.tsx";
import { OnTopToggle } from "./OnTopToggle.tsx";
import type { Last } from "./useDockRuns.ts";

const styles = stylex.create({
  strip: {
    flex: "none",
    boxSizing: "border-box",
    width: size.dockFolded,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s4,
    backgroundColor: color.canvas,
    color: color.claudeText,
  },
  label: {
    writingMode: "vertical-rl",
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.medium,
    color: color.textMuted,
    whiteSpace: "nowrap",
    maxHeight: size.dockStripLabel,
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  claude: { color: color.claudeText },
  danger: { color: color.danger },
  grow: { flex: 1 },
});

// ponytail: the dock folded to its strip — the spark that opens it (Ctrl J), what waits in Actions, and one line:
// Claude working and for how long, not connected, or the last run
export function DockFolded({
  onOpen,
  actions,
  running,
  seconds,
  offline,
  last,
}: {
  onOpen: () => void;
  actions: number;
  running: boolean;
  seconds: number;
  offline: boolean;
  last: Last | null;
}) {
  const line = running
    ? `Claude is working · ${seconds.toFixed(0)} s`
    : offline
      ? "Claude · not connected"
      : last
        ? `Last run · ${last.seconds.toFixed(1)} s${last.ok ? "" : " · failed"}`
        : "Claude";
  return (
    <aside aria-label="Claude" {...stylex.props(styles.strip)}>
      {running ? <Spinner size="md" label="Claude is running" /> : null}
      <Button variant="claude-quiet" icon="claude" iconOnly label="Open Claude" onClick={onOpen} />
      {actions > 0 && <Badge tone="claude" count label={String(actions)} tooltip={plural(actions, "Claude action")} />}
      <span
        title={last && !running ? last.summary.replace(/[*_`]/g, "") : undefined}
        {...stylex.props(
          styles.label,
          (running || (last?.ok && !offline)) && styles.claude,
          (offline || (last && !last.ok && !running)) && styles.danger,
        )}
      >
        {line}
      </span>
      <span {...stylex.props(styles.grow)} />
      <Kbd>Ctrl J</Kbd>
      <OnTopToggle />
    </aside>
  );
}
