import { type ReactNode, useState } from "react";
import { Text } from "../../../components/ui/Text.tsx";

// ponytail: one number or a short list of them (« 1, 1, 5 ») typed in a Text — a value that does not parse keeps the
// field's error and changes nothing; a new value from outside (Reset, Discard) replaces what is shown
export function NumbersField({
  label,
  hint,
  aside = false,
  trailing,
  values,
  count,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  integer = false,
  onChange,
}: {
  label: string;
  hint?: string;
  aside?: boolean;
  trailing?: ReactNode;
  values: number[];
  count: [number, number];
  min?: number;
  max?: number;
  integer?: boolean;
  onChange: (values: number[]) => void;
}) {
  const shown = values.join(", ");
  const [seen, setSeen] = useState(shown);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | undefined>();
  if (shown !== seen) {
    setSeen(shown);
    setText(shown);
    setError(undefined);
  }
  const type = (typed: string) => {
    setText(typed);
    const parts = typed.split(/[,;\s]+/).filter(Boolean);
    const nums = parts.map(Number);
    const ok =
      parts.length >= count[0] &&
      parts.length <= count[1] &&
      nums.every((n) => Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n)));
    if (!ok) {
      const what = count[1] === 1 ? "a number" : `${count[0]} to ${count[1]} numbers, separated by commas`;
      setError(`Type ${what}${integer ? " (whole)" : ""} from ${min}${Number.isFinite(max) ? ` to ${max}` : " up"}.`);
      return;
    }
    setError(undefined);
    setSeen(nums.join(", "));
    onChange(nums);
  };
  return (
    <Text aside={aside} label={label} hint={hint} trailing={trailing} value={text} onChange={type} error={error} />
  );
}
