import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import { color, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Text } from "../ui/Text.tsx";
import { type ContextSummary, contextLine } from "./contexts.ts";

const styles = stylex.create({
  picker: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  head: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textSubtle },
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: space.s3,
    maxHeight: "40vh",
    overflowY: "auto",
  },
  acts: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: space.s1 },
  note: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textSubtle, margin: 0 },
});

// ponytail: the saved contexts a run takes, ticked one by one; what is ticked here goes with this run only
export function ContextPicker({
  all,
  isOn,
  onToggle,
  onNew,
  onManage,
  extra,
  foot = "Ticked contexts go with this run only. The project's defaults are in Settings › Claude.",
}: {
  all: ContextSummary[];
  isOn: (id: string) => boolean;
  onToggle: (id: string, on: boolean) => void;
  onNew?: () => void;
  onManage?: () => void;
  extra?: ReactNode;
  foot?: string;
}) {
  const [find, setFind] = useState("");
  const q = find.trim().toLowerCase();
  const shown = all.filter((c) => !q || c.name.toLowerCase().includes(q));
  return (
    <div {...stylex.props(styles.picker)}>
      <span {...stylex.props(styles.head)}>Saved contexts — this run</span>
      {all.length > 6 && (
        <Text
          ariaLabel="Search contexts"
          type="search"
          icon="search"
          size="sm"
          placeholder="Search by name"
          value={find}
          onChange={setFind}
        />
      )}
      {all.length ? (
        <ul aria-label="Saved contexts" {...stylex.props(styles.list)}>
          {shown.map((c) => (
            <li key={c.id}>
              <Checkbox
                label={c.name || c.id}
                hint={`${c.shared ? "shared · " : "this project · "}${contextLine(c)}`}
                checked={isOn(c.id)}
                onChange={(on) => onToggle(c.id, on)}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p {...stylex.props(styles.note)}>No saved context yet — write a note and save it as a context.</p>
      )}
      <div {...stylex.props(styles.acts)}>
        {extra}
        {onNew && <Button size="sm" variant="quiet" icon="plus" label="New context…" onClick={onNew} />}
        {onManage && <Button size="sm" variant="quiet" icon="settings" label="Manage contexts…" onClick={onManage} />}
      </div>
      <p {...stylex.props(styles.note)}>{foot}</p>
    </div>
  );
}
