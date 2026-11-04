import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { AutosaveStatus } from "../../lib/data/autosave.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Button } from "./Button.tsx";
import { Icon } from "./Icon.tsx";
import { Spinner } from "./Spinner.tsx";
import { type } from "./type.ts";

const styles = stylex.create({
  word: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    flex: "none",
    color: color.textSubtle,
    whiteSpace: "nowrap",
  },
  saving: { color: color.textMuted },
  error: { color: color.danger },
  conflict: { color: color.warning },
  claude: { color: color.claudeText },
});

export type SaveStatus = AutosaveStatus | "claude";

export type SaveStateProps = {
  /** where the last edit stands: pending (« Edited · saves in a moment », after 1 s) · saving · saved · error (« Not
   * saved » with Retry) · conflict (« Changed on disk ») · claude (read-only while a Claude run holds the file);
   * null shows nothing */
  status: SaveStatus | null;
  /** « Not saved »'s Retry */
  onRetry?: () => void;
  /** an inline field (the step editor): « Saved » shows for 3 s after a save, then nothing */
  fade?: boolean;
  /** work on the whole document that is not a save (« Refreshing from Jira… »): a spinner and these words, over the
   * status */
  activity?: string;
  /** when the last save landed (« 10:42 »), in the tooltip of « Saved » */
  at?: string;
  /** a status region (the editor's bar for the whole test): its words are read out as they change; a field's own word is not */
  live?: boolean;
  /** the catalogue only: « Edited » at once, not after 1 s */
  debugState?: "late";
};

function useAfter(on: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!on) {
      setLate(false);
      return;
    }
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return late;
}

function useFresh(status: SaveStatus | null, ms: number): boolean {
  const [fresh, setFresh] = useState(false);
  const was = useRef(status);
  useEffect(() => {
    const before = was.current;
    was.current = status;
    if (status !== "saved" || before === "saved" || before === null) return;
    setFresh(true);
    const t = setTimeout(() => setFresh(false), ms);
    return () => clearTimeout(t);
  }, [status, ms]);
  return fresh;
}

// ponytail: the save state of a field or of a whole document (kit.mjs save, SYSTEM.md « Save states ») — a quiet word
// beside a label or in a bar, never a toast; the one place these words are written
export function SaveState({ status, onRetry, fade = false, activity, at, live = false, debugState }: SaveStateProps) {
  const role = live ? "status" : undefined;
  const edited = useAfter(status === "pending", 1000) || debugState === "late";
  const fresh = useFresh(status, 3000);
  const look = (...more: (false | null | undefined | stylex.StyleXStyles)[]) =>
    stylex.props(type.small, type.regular, styles.word, ...more);
  if (activity)
    return (
      <span role={role} {...look(styles.saving)}>
        <Spinner size="sm" />
        {activity}
      </span>
    );
  if (status === "claude")
    return (
      <span role={role} title="Read-only until the run ends" {...look(styles.claude)}>
        <Icon name="lock" size="sm" />
        Claude is editing
      </span>
    );
  if (status === "saving")
    return (
      <span role={role} {...look(styles.saving)}>
        <Spinner size="sm" />
        Saving…
      </span>
    );
  if (status === "pending")
    return (
      <span role={role} {...look()}>
        {edited ? "Edited · saves in a moment" : null}
      </span>
    );
  if (status === "error")
    return (
      <span role="alert" {...look(styles.error)}>
        <Icon name="alert-circle" size="sm" />
        Not saved
        {onRetry && <Button size="xs" variant="quiet" label="Retry" onClick={onRetry} />}
      </span>
    );
  if (status === "conflict")
    return (
      <span role={role} {...look(styles.conflict)}>
        <Icon name="conflict" size="sm" />
        Changed on disk
      </span>
    );
  if (status === null || (fade && !fresh)) return <span role={role} {...look()} />;
  return (
    <span role={role} title={at ? `Saved ${at}` : undefined} {...look()}>
      <Icon name="check" size="sm" />
      Saved
    </span>
  );
}
