import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { Effort } from "../../../core/types.ts";
import { size, space } from "../../styles/tokens.stylex.ts";
import { Select, type SelectOption } from "../ui/Select.tsx";
import { Text } from "../ui/Text.tsx";

export const MODELS = ["fable", "opus", "sonnet", "haiku"];
export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const VALID = /^[A-Za-z0-9.\-[\]:]+$/;
const CUSTOM = "custom";

const styles = stylex.create({
  row: { display: "inline-flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  block: { display: "flex", width: "100%" },
  custom: { width: size.menuMin },
});

export const effortOptions: SelectOption<Effort>[] = EFFORTS.map((e) => ({ value: e, label: e }));

// ponytail: the model list plus « custom… »; a model the list does not know (a full id, a new alias) is typed in and
// handed over on blur or Enter only, so a half-typed name is never saved nor sent
export function useModelChoice(value: string, onChange: (model: string) => void) {
  const [custom, setCustom] = useState(!MODELS.includes(value));
  const [text, setText] = useState(MODELS.includes(value) ? "" : value);
  useEffect(() => {
    setCustom(!MODELS.includes(value));
    if (!MODELS.includes(value)) setText(value);
  }, [value]);
  const options: SelectOption<string>[] = [
    ...MODELS.map((m) => ({ value: m, label: m })),
    { value: CUSTOM, label: "custom…" },
  ];
  const pick = (v: string) => {
    if (v === CUSTOM) {
      setCustom(true);
      setText("");
      return;
    }
    setCustom(false);
    onChange(v);
  };
  const commit = () => {
    const t = text.trim();
    if (t && VALID.test(t) && t !== value) onChange(t);
  };
  const invalid = !!text.trim() && !VALID.test(text.trim());
  return { selected: custom ? CUSTOM : value, options, pick, custom, text, setText, commit, invalid };
}

export function CustomModel({ choice }: { choice: ReturnType<typeof useModelChoice> }) {
  if (!choice.custom) return null;
  return (
    <span {...stylex.props(styles.custom)}>
      <Text
        ariaLabel="Custom model"
        placeholder="Model id or alias"
        size="sm"
        spellCheck={false}
        value={choice.text}
        error={choice.invalid ? "Letters, digits, . - : [ ] only" : undefined}
        onChange={choice.setText}
        onBlur={choice.commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            choice.commit();
          }
        }}
      />
    </span>
  );
}

export function ModelPicker({
  value,
  onChange,
  label = "Model",
  size: s = "sm",
  appearance = "quiet",
  block = false,
  id,
}: {
  value: string;
  onChange: (model: string) => void;
  label?: string;
  size?: "sm" | "md";
  appearance?: "boxed" | "quiet";
  /** fills its row, like the fields beside it (Settings › Claude dock) */
  block?: boolean;
  /** named by a label outside (`<label htmlFor>`) */
  id?: string;
}) {
  const choice = useModelChoice(value, onChange);
  return (
    <span {...stylex.props(styles.row, block && styles.block)}>
      <Select
        id={id}
        label={label}
        size={s}
        appearance={appearance}
        block={block}
        value={choice.selected}
        options={choice.options}
        onChange={choice.pick}
      />
      <CustomModel choice={choice} />
    </span>
  );
}
