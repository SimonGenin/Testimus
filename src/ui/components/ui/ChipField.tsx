import * as stylex from "@stylexjs/stylex";
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { color, fontSize, lineHeight, radius, shadow, size, space, z } from "../../styles/tokens.stylex.ts";
import { Chip } from "./Chip.tsx";
import { Text } from "./Text.tsx";

const styles = stylex.create({
  anchor: { position: "relative", minWidth: 0 },
  list: {
    boxSizing: "border-box",
    position: "absolute",
    top: `calc(100% + ${space.s2})`,
    insetInlineStart: 0,
    zIndex: z.popover,
    display: "flex",
    flexDirection: "column",
    minWidth: size.menuMin,
    maxWidth: size.menuMax,
    maxHeight: `calc(${size.controlMd} * 8 + 2 * ${space.s2})`,
    overflowY: "auto",
    padding: space.s2,
    borderRadius: radius.r3,
    backgroundColor: color.surfaceRaised,
    boxShadow: shadow.s2,
    fontSize: fontSize.compact,
    lineHeight: lineHeight.compact,
    cursor: "default",
  },
  option: {
    display: "flex",
    alignItems: "center",
    flex: "none",
    height: size.controlMd,
    paddingInline: space.s3,
    borderRadius: radius.r2,
    color: color.text,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": color.surfaceHover },
  },
  active: { backgroundColor: color.surfaceHover },
});

export type ChipChoice = { value: string; label: string };

export type ChipFieldProps = {
  values: string[];
  /** the new set; without it the field is read-only and the chips cannot be removed */
  onChange?: (values: string[]) => void;
  /** the accessible name; shown above the field only with `showLabel` */
  label: string;
  showLabel?: boolean;
  /** an example (« Add a label… »), never the label */
  placeholder?: string;
  /** suggestions for what is typed (labels, issue keys, folders); free text can still be added */
  suggest?: (query: string) => Promise<string[]> | string[];
  /** a closed list (a precondition, a context to attach): only these can be added; a chip shows the label */
  choices?: ChipChoice[];
  /** keys and ids */
  mono?: boolean;
  /** boxed (forms, dialogs) · inline (the test editor: no edge until hovered or focused) */
  appearance?: "boxed" | "inline";
  /** at the end of the field (a Browse… button) */
  trailing?: ReactNode;
  disabled?: boolean;
  autoFocus?: boolean;
  /** the catalogue only: shows hover, focus or the open suggestions without the pointer */
  debugState?: "hover" | "focus" | "open";
};

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

// ponytail: the Text component with chips before the caret (SYSTEM.md): Enter adds, a comma or a semicolon adds,
// leaving adds, Backspace on an empty box removes the last chip; suggestions are a listbox under the field
export function ChipField({
  values,
  onChange,
  label,
  showLabel = false,
  placeholder,
  suggest,
  choices,
  mono = false,
  appearance = "boxed",
  trailing,
  disabled = false,
  autoFocus,
  debugState,
}: ChipFieldProps) {
  const id = useId();
  const listId = `${id}-list`;
  const input = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [found, setFound] = useState<string[]>([]);
  const [active, setActive] = useState(-1);
  const asked = useRef(0);
  const ask = useRef(suggest);
  ask.current = suggest;
  const suggests = suggest !== undefined;

  useEffect(() => {
    if (!suggests || !focused || !ask.current) return;
    const n = ++asked.current;
    void Promise.resolve(ask.current(query)).then((r) => {
      if (n === asked.current) setFound(r);
    });
  }, [suggests, query, focused]);

  const editable = onChange !== undefined;
  const labelOf = (v: string) => choices?.find((c) => c.value === v)?.label ?? v;
  const items: ChipChoice[] = choices
    ? choices.filter((c) => !values.includes(c.value) && fold(c.label).includes(fold(query.trim())))
    : found.filter((v) => !values.includes(v)).map((v) => ({ value: v, label: v }));
  const listed = editable && (choices !== undefined || suggests);
  const open = listed && (focused || debugState === "open") && items.length > 0 && !disabled;
  const shown = open ? Math.min(active, items.length - 1) : -1;

  const add = (raw: string[]) => {
    const fresh = [...new Set(raw.map((v) => v.trim()).filter((v) => v && !values.includes(v)))];
    if (fresh.length) onChange?.([...values, ...fresh]);
    setQuery("");
    setActive(-1);
  };
  const commit = (text: string) => {
    if (choices) {
      const exact = choices.find((c) => fold(c.label) === fold(text.trim()) || c.value === text.trim());
      if (exact) add([exact.value]);
      return;
    }
    add(text.split(/[,;\n]+/));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((shown + step + items.length + (shown < 0 && step < 0 ? 1 : 0)) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown >= 0) add([items[shown].value]);
      else if (choices && query.trim() && items.length) add([items[0].value]);
      else commit(query);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      setFocused(false);
    } else if (e.key === "Backspace" && query === "" && values.length) {
      onChange?.(values.slice(0, -1));
    }
  };

  const chips = values.map((v) => (
    <Chip
      key={v}
      label={labelOf(v)}
      mono={mono}
      inField
      disabled={disabled}
      onRemove={editable && !disabled ? () => onChange(values.filter((x) => x !== v)) : undefined}
    />
  ));
  return (
    <div
      onClick={(e) => {
        if (!(e.target as Element).closest("button, input")) input.current?.focus();
      }}
      {...stylex.props(styles.anchor)}
    >
      <Text
        id={id}
        value={query}
        onChange={(v) => {
          setActive(-1);
          setFocused(true);
          if (!choices && /[,;]$/.test(v)) commit(v);
          else setQuery(v);
        }}
        leading={chips}
        trailing={trailing}
        combobox={
          listed
            ? {
                expanded: open,
                controls: listId,
                activeDescendant: shown >= 0 ? `${id}-${shown}` : undefined,
                autocomplete: "list",
              }
            : undefined
        }
        appearance={appearance}
        label={showLabel ? label : undefined}
        ariaLabel={showLabel ? undefined : label}
        placeholder={editable ? placeholder : undefined}
        readOnly={!editable}
        disabled={disabled}
        autoFocus={autoFocus}
        spellCheck={false}
        inputRef={input}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          if (editable && !choices) commit(query);
          setFocused(false);
        }}
        debugState={debugState === "open" ? "focus" : debugState}
      />
      {open && (
        <div id={listId} role="listbox" tabIndex={-1} aria-label={label} {...stylex.props(styles.list)}>
          {items.map((c, i) => (
            <div
              key={c.value}
              id={`${id}-${i}`}
              role="option"
              tabIndex={-1}
              aria-selected={i === shown}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add([c.value])}
              {...stylex.props(styles.option, i === shown && styles.active)}
            >
              {c.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
