import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { useDraft } from "../../lib/data/autosave.ts";
import {
  border,
  color,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { Button } from "./Button.tsx";
import { Chip } from "./Chip.tsx";
import { Icon } from "./Icon.tsx";
import { Kbd } from "./Kbd.tsx";
import { Select, type SelectOption } from "./Select.tsx";
import { Spinner } from "./Spinner.tsx";
import { Text, type TextProps } from "./Text.tsx";

const styles = stylex.create({
  frame: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: { default: color.borderControl, ":focus-within": color.claude },
    boxShadow: { default: null, ":focus-within": `0 0 0 ${border.width} ${color.claude}` },
    borderRadius: radius.r3,
    backgroundColor: color.surface,
    overflow: "hidden",
  },
  plain: { borderRadius: radius.r2 },
  frameless: { borderWidth: 0, borderRadius: 0, boxShadow: { default: null, ":focus-within": null } },
  running: { borderColor: color.claudeBorder },
  disabled: { backgroundColor: color.surfaceSunken, borderColor: color.border },
  forceFocus: { borderColor: color.claude, boxShadow: `0 0 0 ${border.width} ${color.claude}` },
  row: {
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
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    minHeight: size.controlLg,
    paddingBlock: space.s2,
    paddingInlineStart: space.s3,
    paddingInlineEnd: space.s2,
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
    backgroundColor: color.surface,
  },
  footRunning: { backgroundColor: color.claudeSubtle },
  grow: { flex: 1 },
  scope: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    marginInlineEnd: space.s2,
    whiteSpace: "nowrap",
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.medium,
    color: color.claudeText,
  },
  hint: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    fontSize: fontSize.small,
    color: color.textSubtle,
    whiteSpace: "nowrap",
  },
  timer: {
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    color: color.claudeText,
  },
});

export type Choice = { value: string; options: SelectOption<string>[]; onChange: (value: string) => void };
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
  /** ctrl-enter (default) and enter call onSubmit; autosave saves like Text (a To fix note, a context's notes) */
  submit?: "ctrl-enter" | "enter" | "autosave";
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

const elapsed = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

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
        plain && styles.plain,
        frameless && styles.frameless,
        busy && styles.running,
        (off || text.disabled) && styles.disabled,
        text.debugState === "focus" && styles.forceFocus,
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
                label="Add context"
                disabled={busy}
                onClick={onAddContext}
              />
            ))}
        </div>
      )}
      {quickAsks && quickAsks.length > 0 && (
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
        <div {...stylex.props(styles.foot, busy && styles.footRunning)}>
          {scope && (
            <span {...stylex.props(styles.scope)}>
              <Icon name="claude" size="sm" />
              {scope}
            </span>
          )}
          {model && (
            <Select
              label="Model"
              appearance="quiet"
              size="sm"
              value={model.value}
              options={model.options}
              onChange={model.onChange}
              disabled={busy}
            />
          )}
          {effort && (
            <Select
              label="Effort"
              appearance="quiet"
              size="sm"
              value={effort.value}
              options={effort.options}
              onChange={effort.onChange}
              disabled={busy}
            />
          )}
          <span {...stylex.props(styles.grow)} />
          {busy ? (
            <>
              <span {...stylex.props(styles.hint)}>
                <Spinner size="sm" />
                Claude is working
              </span>
              <span {...stylex.props(styles.timer)}>{elapsed(running)}</span>
              {onCancel && <Button size="sm" variant="quiet" label="Cancel" onClick={onCancel} />}
            </>
          ) : (
            <>
              <span {...stylex.props(styles.hint)}>
                {off ? (
                  unavailable
                ) : submit === "enter" ? (
                  <>
                    <Kbd>Enter</Kbd> to send
                  </>
                ) : (
                  <>
                    <Kbd>Ctrl Enter</Kbd> to send
                  </>
                )}
              </span>
              <Button
                size="sm"
                variant="claude"
                icon="send"
                label={submitLabel}
                disabled={off ? unavailable : !allowEmpty && !value.trim()}
                onClick={send}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
