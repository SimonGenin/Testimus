import * as stylex from "@stylexjs/stylex";
import { Button } from "../../../components/ui/Button.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Spinner } from "../../../components/ui/Spinner.tsx";
import type { AutosaveStatus } from "../../../lib/data/autosave.ts";
import { color, fontSize, lineHeight, space } from "../../../styles/tokens.stylex.ts";

const styles = stylex.create({
  word: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    flex: "none",
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textMuted,
    whiteSpace: "nowrap",
  },
  error: { color: color.danger },
  conflict: { color: color.warning },
  claude: { color: color.claudeText },
});

// the state of the whole test in the editor's bar: what the last edit became, or what holds it
export function SaveStatus({
  status,
  activity,
  claude,
  onRetry,
}: {
  status: AutosaveStatus | null;
  activity?: string;
  claude?: boolean;
  onRetry: () => void;
}) {
  if (claude)
    return (
      <span role="status" {...stylex.props(styles.word, styles.claude)}>
        <Icon name="lock" size="sm" />
        Claude is editing…
      </span>
    );
  if (activity)
    return (
      <span role="status" {...stylex.props(styles.word)}>
        <Spinner size="sm" />
        {activity}
      </span>
    );
  if (status === "saving" || status === "pending")
    return (
      <span role="status" {...stylex.props(styles.word)}>
        <Spinner size="sm" />
        Saving…
      </span>
    );
  if (status === "error")
    return (
      <span role="alert" {...stylex.props(styles.word, styles.error)}>
        <Icon name="alert-circle" size="sm" />
        Not saved
        <Button variant="quiet" size="xs" label="Retry" onClick={onRetry} />
      </span>
    );
  if (status === "conflict")
    return (
      <span role="status" {...stylex.props(styles.word, styles.conflict)}>
        <Icon name="conflict" size="sm" />
        Changed on disk
      </span>
    );
  if (status === "saved")
    return (
      <span role="status" {...stylex.props(styles.word)}>
        <Icon name="check" size="sm" />
        Saved
      </span>
    );
  return <span role="status" {...stylex.props(styles.word)} />;
}
