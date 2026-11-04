import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { useDraft } from "../../lib/data/autosave.ts";
import {
  border,
  color,
  container,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { Button } from "./Button.tsx";
import { Chip } from "./Chip.tsx";
import { GroupSelect, type SelectGroup } from "./GroupSelect.tsx";
import { halo } from "./halo.ts";
import { Icon } from "./Icon.tsx";
import { Kbd } from "./Kbd.tsx";
import { Spinner } from "./Spinner.tsx";
import { Text, type TextProps } from "./Text.tsx";
import { Timer } from "./Timer.tsx";

const styles = stylex.create({
  frame: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: { default: color.borderField, ":focus-within": color.claude },
    borderRadius: radius.r4,
    backgroundColor: color.surface,
    overflow: "hidden",
  },
  plain: { borderRadius: radius.r2 },
  frameless: { borderWidth: 0, borderRadius: 0, boxShadow: "none" },
  running: { borderColor: color.claudeBorder },
  disabled: { backgroundColor: color.surfaceSunken, borderColor: color.border, boxShadow: "none" },
  forceFocus: { borderColor: color.claude },
  row: {
    boxSizing: "border-box",
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    paddingTop: space.s3,
    paddingInline: space.s3,
  },
  rowLabel: {
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.textSubtle,
    marginInlineEnd: space.s1,
  },
  foot: {
    boxSizing: "border-box",
    containerType: "inline-size",
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: size.controlLg,
    paddingBlock: space.s2,
    paddingInlineStart: space.s4,
    paddingInlineEnd: space.s2,
    backgroundColor: "transparent",
  },
  footRunning: { backgroundColor: color.claudeSubtle },
  footWrap: { flexWrap: "wrap" },
  grow: { flex: 1, minWidth: 0 },
  keep: { flex: "none", display: "inline-flex" },
  scope: {
    display: "inline-flex",
    alignItems: "center",
    flex: "0 1 auto",
    gap: space.s2,
    minWidth: 0,
    marginInlineEnd: space.s2,
    whiteSpace: "nowrap",
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.medium,
    color: color.claudeText,
  },
  clip: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  hint: {
    display: "inline-flex",
    alignItems: "center",
    flex: "0 1 auto",
    gap: space.s2,
    minWidth: 0,
    fontSize: fontSize.small,
    color: color.textSubtle,
    whiteSpace: "nowrap",
  },
  whole: { flex: "none" },
  foldableWords: { display: { default: "inline", [container.paneCompact]: "none" } },
  pushEnd: { marginInlineStart: "auto" },
});

export type Choice = Omit<SelectGroup, "label">;
export type RunChoice = { model?: string; effort?: string; contexts: string[] };

export type ClaudeBlockProps = Omit<TextProps, "multiline" | "appearance" | "onKeyDown"> & {
  /** the run's effective contexts; a chip switched off is left out of this run only */
  contexts?: { id: string; label: string; on: boolean }[];
  onContext?: (id: string, on: boolean) => void;
  onAddContext?: () => void;
  /** in place of the « Add context » button: a trigger of the owner's (a Popover listing the contexts) */
  addContext?: ReactNode;
  /** inside the frame, under the text and above the foot (an additional note, a custom model's name) */
  children?: ReactNode;
  /** chips that put their prompt in the box; typing clears the pressed one */
  quickAsks?: { label: string; prompt: string }[];
  model?: Choice;
  effort?: Choice;
  /** ctrl-enter (default) and enter call onSubmit; autosave saves like Text (a To fix note, a context's notes); none
   * keeps the foot (scope, model, effort) without a send button — the owner's own button acts (Generate), Ctrl+Enter
   * still calls onSubmit */
  submit?: "ctrl-enter" | "enter" | "autosave" | "none";
  onSubmit?: (prompt: string, run: RunChoice) => void;
  submitLabel?: string;
  /** a run on a test or the project may start with an empty box */
  allowEmpty?: boolean;
  /** « Step 2 », « Whole test », « Whole project » */
  scope?: string;
  /** seconds since the run started: the box is read-only and offers Cancel */
  running?: number | null;
  onCancel?: () => void;
  /** Claude is not there: the reason replaces the hint and Send is off */
  unavailable?: string;
  /** a frame with the tighter radius (inside a card) */
  plain?: boolean;
  /** no frame at all: the container draws it (the « Ask Claude » popover) */
  frameless?: boolean;
};

// ponytail: every place where one writes to or for Claude is the Text component inside this frame — never a second text
// box; contexts, quick asks, model and effort, send or autosave are options
export function ClaudeBlock(props: ClaudeBlockProps) {
  const {
    contexts,
    onContext,
    onAddContext,
    addContext,
    children,
    quickAsks,
    model,
    effort,
    submit = "ctrl-enter",
    onSubmit,
    submitLabel = "Send",
    allowEmpty = false,
    scope,
    running = null,
    onCancel,
    unavailable,
    plain = false,
    frameless = false,
    ...text
  } = props;
  const autosave = submit === "autosave";
  const [draft, setDraft, clearDraft] = useDraft(autosave ? null : (text.draftKey ?? null), text.value);
  const [plainValue, setPlainValue] = useState(text.value);
  const value = autosave ? text.value : text.draftKey ? draft : text.onChange ? text.value : plainValue;
  const [pressed, setPressed] = useState<number | null>(null);
  const busy = running !== null && running !== undefined;
  const off = unavailable !== undefined;

  const change = (v: string) => {
    if (pressed !== null && quickAsks?.[pressed]?.prompt !== v) setPressed(null);
    if (text.draftKey && !autosave) setDraft(v);
    else if (!text.onChange) setPlainValue(v);
    text.onChange?.(v);
  };
  const send = () => {
    if (busy || off || !onSubmit || (!allowEmpty && !value.trim())) return;
    onSubmit(value, {
      model: model?.value,
      effort: effort?.value,
      contexts: (contexts ?? []).filter((c) => c.on).map((c) => c.id),
    });
    if (text.draftKey) clearDraft();
    else if (!text.onChange) setPlainValue("");
    setPressed(null);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (autosave || e.key !== "Enter") return;
    if (submit === "enter" ? !e.shiftKey : e.ctrlKey || e.metaKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div
      {...stylex.props(
        styles.frame,
        halo.claudeWithin,
        plain && styles.plain,
        frameless && styles.frameless,
        busy && styles.running,
        (off || text.disabled) && styles.disabled,
        text.debugState === "focus" && [styles.forceFocus, halo.claudeShown],
      )}
    >
      {contexts && (
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.rowLabel)}>Context</span>
          {contexts.map((c) => (
            <Chip
              key={c.id}
              label={c.label}
              tone="claude"
              icon="context"
              pressed={c.on}
              strikeOff
              disabled={busy}
              onToggle={() => onContext?.(c.id, !c.on)}
            />
          ))}
          {addContext ??
            (onAddContext && (
              <Button
                size="sm"
                variant="quiet"
                icon="plus"
                iconOnly
                label="Add context"
                disabled={busy}
                onClick={onAddContext}
              />
            ))}
        </div>
      )}
      {quickAsks && quickAsks.length > 0 && !off && (
        <div {...stylex.props(styles.row)}>
          {quickAsks.map((q, i) => (
            <Chip
              key={q.label}
              label={q.label}
              tone="claude"
              pressed={pressed === i}
              disabled={busy}
              onToggle={() => {
                const next = pressed === i ? null : i;
                setPressed(next);
                change(next === null ? "" : q.prompt);
                if (next !== null) setPressed(next);
              }}
            />
          ))}
        </div>
      )}
      <Text
        {...text}
        value={value}
        onChange={change}
        multiline
        appearance="bare"
        readOnly={busy || text.readOnly}
        disabled={off || text.disabled}
        lockedBy={null}
        onKeyDown={onKeyDown}
        draftKey={undefined}
      />
      {children}
      {!autosave && (
        <div {...stylex.props(styles.foot, busy && styles.footRunning, off && styles.footWrap)}>
          {scope && !busy && (
            <span {...stylex.props(styles.scope, off && styles.whole)}>
              <Icon name="target" size="sm" />
              <span {...stylex.props(styles.clip)}>{scope}</span>
            </span>
          )}
          {(model || effort) && !busy && (
            <span {...stylex.props(styles.keep)}>
              <GroupSelect
                label="Model and effort"
                groups={[
                  ...(model ? [{ label: "Model", ...model }] : []),
                  ...(effort ? [{ label: "Effort", ...effort }] : []),
                ]}
                disabled={off ? unavailable : text.disabled || text.readOnly ? "Locked while Claude works" : false}
              />
            </span>
          )}
          <span {...stylex.props(styles.grow)} />
          {busy ? (
            <>
              <span {...stylex.props(styles.hint, styles.whole)}>
                <Spinner size="sm" />
                <span>Claude is working</span>
                <Timer seconds={running} />
              </span>
              {onCancel && (
                <span {...stylex.props(styles.keep)}>
                  <Button size="sm" icon="stop" label="Cancel" onClick={onCancel} />
                </span>
              )}
            </>
          ) : submit === "none" ? (
            off && <span {...stylex.props(styles.hint, styles.whole)}>{unavailable}</span>
          ) : (
            <>
              {off ? (
                <span {...stylex.props(styles.hint, styles.whole, styles.pushEnd)}>{unavailable}</span>
              ) : (
                <span {...stylex.props(styles.hint, styles.keep)}>
                  <Kbd>{submit === "enter" ? "Enter" : "Ctrl+Enter"}</Kbd>
                  <span {...stylex.props(styles.foldableWords)}>to send</span>
                </span>
              )}
              <span {...stylex.props(styles.keep)}>
                <Button
                  size="sm"
                  variant="claude"
                  icon="send"
                  label={submitLabel}
                  disabled={off ? unavailable : !allowEmpty && !value.trim()}
                  onClick={send}
                />
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
