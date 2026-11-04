import * as stylex from "@stylexjs/stylex";
import {
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { type AutosaveStatus, type Save, useAutosave, useDraft } from "../../lib/data/autosave.ts";
import type { Key } from "../../lib/data/query.ts";
import {
  border,
  color,
  duration,
  easing,
  focus,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  size,
  space,
} from "../../styles/tokens.stylex.ts";
import { Banner } from "./Banner.tsx";
import { Button } from "./Button.tsx";
import { Icon, type IconName } from "./Icon.tsx";
import { Spinner } from "./Spinner.tsx";

const FOCUS = `0 0 0 ${border.width} ${color.focusRing}, 0 0 0 ${focus.halo} color-mix(in srgb, ${color.focusRing} 18%, transparent)`;

const styles = stylex.create({
  field: { display: "flex", flexDirection: "column", gap: space.snug, minWidth: 0 },
  label: {
    display: "flex",
    alignItems: "baseline",
    gap: space.s3,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    fontWeight: fontWeight.medium,
    color: color.text,
  },
  labelState: { marginInlineStart: "auto" },
  hint: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textSubtle },
  error: {
    display: "flex",
    gap: space.s2,
    alignItems: "center",
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    color: color.danger,
  },
  box: {
    boxSizing: "border-box",
    position: "relative",
    display: "flex",
    alignItems: "flex-start",
    gap: space.s3,
    minHeight: size.controlMd,
    paddingBlock: `calc((${size.controlMd} - ${lineHeight.body}) / 2 - ${border.width})`,
    paddingInline: space.s4,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: {
      default: color.borderField,
      ":hover": color.borderControl,
      ":focus-within": color.focusRing,
    },
    boxShadow: { default: null, ":focus-within": FOCUS },
    borderRadius: radius.r2,
    backgroundColor: color.surface,
    color: color.text,
    fontSize: fontSize.body,
    lineHeight: lineHeight.body,
    cursor: "text",
    transitionProperty: "border-color, background-color",
    transitionDuration: duration.instant,
    transitionTimingFunction: easing.standard,
  },
  multi: { minHeight: `calc(${lineHeight.body} * 3 + ${space.s3})` },
  sm: {
    minHeight: size.controlSm,
    paddingBlock: border.width,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
  },
  inline: {
    paddingInline: space.s3,
    borderColor: { default: "transparent", ":hover": "transparent", ":focus-within": color.focusRing },
    backgroundColor: { default: "transparent", ":hover": color.surfaceHover },
  },
  inlineMulti: { minHeight: size.controlMd },
  bare: {
    borderWidth: 0,
    borderColor: "transparent",
    boxShadow: "none",
    backgroundColor: "transparent",
    paddingBlock: space.s3,
    paddingInline: space.s4,
  },
  bareMulti: { minHeight: `calc(${lineHeight.body} * 2 + ${space.s5})` },
  bareStill: { backgroundColor: "transparent", borderWidth: 0 },
  wraps: {
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s2,
    paddingBlock: space.inset,
    paddingInline: space.s2,
  },
  wrapsValue: { minWidth: size.chipInputMin, paddingInline: space.s2, fontSize: fontSize.compact },
  title: { fontSize: fontSize.title, lineHeight: lineHeight.title, fontWeight: fontWeight.semibold },
  invalid: {
    borderColor: color.danger,
    boxShadow: `0 0 0 ${border.width} ${color.danger}, 0 0 0 ${focus.halo} color-mix(in srgb, ${color.danger} 14%, transparent)`,
  },
  disabled: {
    backgroundColor: color.surfaceSunken,
    borderColor: color.border,
    boxShadow: "none",
    color: color.textDisabled,
    cursor: "not-allowed",
  },
  readOnly: {
    backgroundColor: color.surfaceSunken,
    borderColor: "transparent",
    boxShadow: "none",
    cursor: "default",
  },
  claude: {
    backgroundColor: color.claudeSubtle,
    borderColor: color.claudeBorder,
    boxShadow: "none",
    cursor: "progress",
  },
  lead: { display: "inline-flex", marginTop: space.s1, color: color.textSubtle },
  value: {
    boxSizing: "border-box",
    flex: 1,
    minWidth: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: "inherit",
    fontFamily: "inherit",
    fontSize: "inherit",
    lineHeight: "inherit",
    fontWeight: "inherit",
    "::placeholder": { color: color.textSubtle },
  },
  area: { resize: "none", overflow: "hidden", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  trail: { display: "inline-flex", alignItems: "center", gap: space.s2, alignSelf: "center", color: color.textSubtle },
  trailMulti: { alignSelf: "flex-end" },
  state: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s2,
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
    fontWeight: fontWeight.regular,
    color: color.textSubtle,
    whiteSpace: "nowrap",
  },
  stateSaving: { color: color.textMuted },
  stateError: { color: color.danger },
  stateConflict: { color: color.warning },
  stateClaude: { color: color.claudeText },
  stateBelow: { alignSelf: "flex-end" },
  forceHover: { borderColor: color.borderControl },
  forceHoverInline: { borderColor: "transparent", backgroundColor: color.surfaceHover },
  forceFocus: { borderColor: color.focusRing, boxShadow: FOCUS },
});

// the save state a bound field shows (the autosave of the document it writes into)
export type SaveState = {
  status: AutosaveStatus;
  error?: string;
  flush(): Promise<void>;
  retry(): Promise<void>;
  keepMine(): Promise<void>;
  takeDisk(): void;
};

export type TextProps = {
  value: string;
  /** a plain field (submitted by its dialog) or a field bound to a document's autosave */
  onChange?: (value: string) => void;
  /** saves by itself: 400 ms after the last key (or `delay`), on blur, window blur and unmount; returns the file's
   * version after the save when it knows it */
  save?: Save<string>;
  /** the read this field saves (its autosave and draft live under it); required with `save` */
  saveKey?: Key;
  /** the version of what `value` was read from (the file's mtime): a change on disk under an edit is a conflict */
  base?: string;
  delay?: number | "blur";
  /** the autosave of the document this field writes a part of (the test editor): its state is shown here */
  autosave?: SaveState;
  /** a plain field keeps its unsent value under this key when the screen changes */
  draftKey?: Key;
  multiline?: boolean;
  /** boxed (forms, dialogs, settings) · inline (the step editor: no edge until hovered or focused) · bare (inside a
   * frame that draws the edge: the Claude block) */
  appearance?: "boxed" | "inline" | "bare";
  size?: "sm" | "md";
  /** the test summary: 16 px semibold, single line */
  title?: boolean;
  label?: string;
  /** the accessible name when there is no visible label */
  ariaLabel?: string;
  hint?: string;
  placeholder?: string;
  error?: string;
  icon?: IconName;
  /** content before the value that wraps with it (the chips of a chip field) */
  leading?: ReactNode;
  trailing?: ReactNode;
  /** the field drives a list of suggestions (a chip field, a folder picker): its combobox state */
  combobox?: {
    expanded: boolean;
    controls: string;
    activeDescendant?: string;
    autocomplete?: "list" | "both" | "none";
  };
  /** read-only while a Claude run holds the file */
  lockedBy?: "claude" | null;
  disabled?: boolean;
  readOnly?: boolean;
  type?: "text" | "password" | "search" | "email" | "url";
  name?: string;
  id?: string;
  autoFocus?: boolean;
  spellCheck?: boolean;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement>;
  /** the catalogue only: shows hover or focus without the pointer */
  debugState?: "hover" | "focus";
};

// ponytail: the only editable text of the app (N2) — a screen hands it a value and a way to save; growing, autosave,
// drafts, conflicts and the Claude lock are done here once
export function Text(props: TextProps) {
  if (props.save) {
    if (!props.saveKey) throw new Error("Text: `save` needs `saveKey` (the read it saves).");
    return <SavingText {...props} save={props.save} saveKey={props.saveKey} />;
  }
  if (props.draftKey && !props.autosave) return <DraftText {...props} draftKey={props.draftKey} />;
  return <TextField {...props} />;
}

function SavingText(props: TextProps & { save: Save<string>; saveKey: Key }) {
  const a = useAutosave<string>({
    key: props.saveKey,
    value: props.value,
    base: props.base,
    save: props.save,
    delay: props.delay,
    readOnly: props.lockedBy === "claude" || props.readOnly || props.disabled,
  });
  return (
    <TextField
      {...props}
      value={a.value ?? props.value}
      onChange={(v) => {
        a.set(v);
        props.onChange?.(v);
      }}
      autosave={a}
    />
  );
}

function DraftText(props: TextProps & { draftKey: Key }) {
  const [draft, setDraft] = useDraft(props.draftKey, props.value);
  return (
    <TextField
      {...props}
      value={draft}
      onChange={(v) => {
        setDraft(v);
        props.onChange?.(v);
      }}
    />
  );
}

function useEditedAfter(status: AutosaveStatus | undefined, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (status !== "pending") {
      setLate(false);
      return;
    }
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [status, ms]);
  return late;
}

function useFresh(status: AutosaveStatus | undefined, ms: number): boolean {
  const [fresh, setFresh] = useState(false);
  const was = useRef(status);
  useEffect(() => {
    const before = was.current;
    was.current = status;
    if (status !== "saved" || before === "saved" || before === undefined) return;
    setFresh(true);
    const t = setTimeout(() => setFresh(false), ms);
    return () => clearTimeout(t);
  }, [status, ms]);
  return fresh;
}

function SaveWord({ a, claude, inline }: { a?: SaveState; claude: boolean; inline: boolean }) {
  const edited = useEditedAfter(a?.status, 1000);
  const fresh = useFresh(a?.status, 3000);
  if (claude)
    return (
      <span {...stylex.props(styles.state, styles.stateClaude)}>
        <Icon name="lock" size="sm" />
        Read-only — Claude is editing
      </span>
    );
  if (!a) return null;
  if (a.status === "saving")
    return (
      <span {...stylex.props(styles.state, styles.stateSaving)}>
        <Spinner size="sm" />
        Saving…
      </span>
    );
  if (a.status === "pending") return edited ? <span {...stylex.props(styles.state)}>Edited</span> : null;
  if (a.status === "error")
    return (
      <span role="alert" {...stylex.props(styles.state, styles.stateError)}>
        <Icon name="alert-circle" size="sm" />
        Not saved
        <Button size="xs" variant="quiet" label="Retry" onClick={() => void a.retry()} />
      </span>
    );
  if (a.status === "conflict")
    return (
      <span {...stylex.props(styles.state, styles.stateConflict)}>
        <Icon name="conflict" size="sm" />
        Changed on disk
      </span>
    );
  if (inline && !fresh) return null;
  return (
    <span {...stylex.props(styles.state)}>
      <Icon name="check" size="sm" />
      Saved
    </span>
  );
}

// ponytail: a growing field is as tall as its text at its width — measured again when the value changes and when only
// the width does (the editor's Action | Expected switch, a dragged pane, the window); its own height change is ignored,
// so the measure never loops
function grow(el: HTMLTextAreaElement, text: string): void {
  el.style.height = "auto";
  el.style.height = text ? `${el.scrollHeight}px` : "";
}

function TextField(p: TextProps) {
  const auto = useId();
  const id = p.id ?? auto;
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const multiline = p.multiline === true && !p.title;
  const claude = p.lockedBy === "claude";
  const locked = claude || p.readOnly === true;
  const inline = p.appearance === "inline";
  const a = p.autosave;

  const value = p.value;
  useLayoutEffect(() => {
    const el = ref.current;
    if (multiline && el instanceof HTMLTextAreaElement) grow(el, value);
  }, [multiline, value]);
  useEffect(() => {
    const el = ref.current;
    if (!multiline || !(el instanceof HTMLTextAreaElement) || typeof ResizeObserver === "undefined") return;
    let width = el.getBoundingClientRect().width;
    const watch = new ResizeObserver(([entry]) => {
      const now = entry?.contentRect.width ?? el.getBoundingClientRect().width;
      if (now === width) return;
      width = now;
      grow(el, el.value);
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, [multiline]);

  const setRef = (el: HTMLTextAreaElement | HTMLInputElement | null) => {
    ref.current = el;
    if (typeof p.inputRef === "function") p.inputRef(el);
    else if (p.inputRef) (p.inputRef as { current: unknown }).current = el;
  };
  const hintId = p.hint ? `${id}-hint` : undefined;
  const errorId = p.error ? `${id}-error` : undefined;
  const common = {
    id,
    name: p.name,
    value: p.value,
    placeholder: p.placeholder,
    disabled: p.disabled,
    readOnly: locked,
    autoFocus: p.autoFocus,
    spellCheck: p.spellCheck,
    "aria-label": p.label ? undefined : p.ariaLabel,
    "aria-invalid": p.error ? true : undefined,
    "aria-describedby": [hintId, errorId].filter(Boolean).join(" ") || undefined,
    role: p.combobox ? "combobox" : undefined,
    "aria-expanded": p.combobox?.expanded,
    "aria-controls": p.combobox?.controls,
    "aria-activedescendant": p.combobox?.activeDescendant,
    "aria-autocomplete": p.combobox?.autocomplete,
    onKeyDown: p.onKeyDown,
    onFocus: p.onFocus,
    onBlur: () => {
      void a?.flush();
      p.onBlur?.();
    },
  };
  const word = <SaveWord a={a} claude={claude} inline={inline} />;
  return (
    <div {...stylex.props(styles.field)}>
      {p.label && (
        <div {...stylex.props(styles.label)}>
          <label htmlFor={id}>{p.label}</label>
          <span {...stylex.props(styles.labelState)}>{word}</span>
        </div>
      )}
      <div
        {...stylex.props(
          styles.box,
          multiline && styles.multi,
          p.size === "sm" && styles.sm,
          inline && styles.inline,
          inline && multiline && styles.inlineMulti,
          p.appearance === "bare" && styles.bare,
          p.appearance === "bare" && multiline && styles.bareMulti,
          p.title && styles.title,
          p.appearance !== "bare" && p.debugState === "hover" && (inline ? styles.forceHoverInline : styles.forceHover),
          p.appearance !== "bare" && p.debugState === "focus" && styles.forceFocus,
          p.error !== undefined && styles.invalid,
          p.readOnly && styles.readOnly,
          claude && styles.claude,
          p.disabled && styles.disabled,
          p.appearance === "bare" && (locked || p.disabled) && styles.bareStill,
          p.leading !== undefined && styles.wraps,
        )}
      >
        {p.icon && (
          <span {...stylex.props(styles.lead)}>
            <Icon name={p.icon} />
          </span>
        )}
        {p.leading}
        {multiline ? (
          <textarea
            {...common}
            ref={setRef}
            rows={inline ? 1 : 3}
            onChange={(e) => p.onChange?.(e.target.value)}
            {...stylex.props(styles.value, styles.area)}
          />
        ) : (
          <input
            {...common}
            ref={setRef}
            type={p.type ?? "text"}
            onChange={(e) => p.onChange?.(e.target.value)}
            {...stylex.props(styles.value, p.leading !== undefined && styles.wrapsValue)}
          />
        )}
        {p.trailing && <span {...stylex.props(styles.trail, multiline && styles.trailMulti)}>{p.trailing}</span>}
      </div>
      {!p.label && (a || claude) && <span {...stylex.props(styles.stateBelow)}>{word}</span>}
      {a?.status === "conflict" && (
        <Banner
          tone="warning"
          compact
          title="Changed on disk"
          actions={
            <>
              <Button size="sm" label="Reload from disk" onClick={() => a.takeDisk()} />
              <Button size="sm" variant="quiet" label="Keep mine" onClick={() => void a.keepMine()} />
            </>
          }
        >
          This file changed on disk while you were editing it.
        </Banner>
      )}
      {p.error && (
        <span id={errorId} {...stylex.props(styles.error)}>
          <Icon name="alert-circle" size="sm" />
          {p.error}
        </span>
      )}
      {p.hint && (
        <span id={hintId} {...stylex.props(styles.hint)}>
          {p.hint}
        </span>
      )}
    </div>
  );
}
