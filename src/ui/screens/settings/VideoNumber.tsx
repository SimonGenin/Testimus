import { useState } from "react";
import { Text } from "../../components/ui/Text.tsx";
import { project } from "../../lib/data/client.ts";
import type { Key } from "../../lib/data/query.ts";
import { useSetProject } from "./project.ts";

// ponytail: a number as a person types it — a comma or a point for the decimals; null when it is not one, or not
// between 0 and the most the setting takes
function numberOf(typed: string, max?: number): number | null {
  const n = Number(typed.trim().replace(",", "."));
  return typed.trim() !== "" && Number.isFinite(n) && n >= 0 && (max === undefined || n <= max) ? n : null;
}

// ponytail: one of project.json video's numbers (the loop's margin, the room the videos may take) — typed, saved when
// the field is left or Enter is pressed; an empty box goes back to what the setting is without a value
export function VideoNumber({
  field,
  label,
  hint,
  placeholder,
  saved,
  empty,
  max,
}: {
  field: "margin" | "diskCapGB";
  label: string;
  hint: string;
  placeholder?: string;
  /** what project.json holds (absent: `empty`) */
  saved: number | undefined;
  /** what an empty box means, and what is saved for it */
  empty: number;
  max?: number;
}) {
  const setProject = useSetProject();
  const [typed, setTyped] = useState<string | null>(null);
  const now = saved ?? empty;
  const saveKey: Key = [project(), "project.info", { field: `video.${field}` }];
  const why = max === undefined ? "A number, 0 or more" : `A number from 0 to ${max}`;
  const read = (text: string) => (text.trim() === "" ? empty : numberOf(text, max));
  return (
    <Text
      aside
      label={label}
      hint={hint}
      placeholder={placeholder}
      value={placeholder && now === empty ? "" : String(now)}
      saveKey={saveKey}
      delay="blur"
      onChange={setTyped}
      error={typed !== null && read(typed) === null ? why : undefined}
      save={async (value) => {
        const n = read(value);
        if (n === null) throw new Error(why);
        if (n !== now) await setProject({ video: { [field]: n } }, "the videos' settings");
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLElement).blur();
      }}
    />
  );
}
