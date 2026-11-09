import * as stylex from "@stylexjs/stylex";
import type { Effort } from "../../../core/types.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { Select, type SelectOption } from "../ui/Select.tsx";

export const MODELS = ["fable", "opus", "sonnet", "haiku"];
export const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
export const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const styles = stylex.create({
  row: { display: "inline-flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  block: { display: "flex", width: "100%" },
});

export const effortOptions: SelectOption<Effort>[] = EFFORTS.map((e) => ({ value: e, label: e }));

// ponytail: the model list only; a model saved before that the list does not know is shown as it is, never typed in
export function useModelChoice(value: string, onChange: (model: string) => void) {
  const options: SelectOption<string>[] = [...MODELS, ...(value && !MODELS.includes(value) ? [value] : [])].map(
    (m) => ({ value: m, label: m }),
  );
  return { selected: value, options, pick: onChange };
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
    </span>
  );
}
