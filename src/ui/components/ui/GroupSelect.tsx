import * as stylex from "@stylexjs/stylex";
import { color, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { Button } from "./Button.tsx";
import type { IconName } from "./Icon.tsx";
import { Menu, type MenuEntry } from "./Menu.tsx";
import type { SelectOption } from "./Select.tsx";

const styles = stylex.create({
  wrap: { display: "inline-flex", alignItems: "center", gap: space.s1, minWidth: 0 },
  prefix: { color: color.textMuted, fontSize: fontSize.small, lineHeight: lineHeight.small, whiteSpace: "nowrap" },
});

export type SelectGroup = {
  /** the group's title in the list (« Model », « Effort ») */
  label: string;
  value: string;
  options: SelectOption<string>[];
  onChange: (value: string) => void;
  /** the word the field shows for this group, when the chosen option's label is too long for it */
  shown?: string;
};

export type GroupSelectProps = {
  /** one value per group, all chosen in one list (model · effort) */
  groups: SelectGroup[];
  /** the accessible name of the list (« Model and effort ») */
  label: string;
  /** a word before the field (« Claude ») */
  prefix?: string;
  icon?: IconName;
  /** true, or the reason, shown as a tooltip */
  disabled?: boolean | string;
  /** the catalogue only: drawn open in place */
  debugState?: "open";
};

const shownOf = (g: SelectGroup) => g.shown ?? g.options.find((o) => o.value === g.value)?.label ?? g.value;

// ponytail: a quiet select that holds several values at once (SYSTEM.md Select: model and effort are one quiet select
// « opus · high »); the field shows them joined by « · », the open list is the Menu, one group per value, the chosen
// option checked
export function GroupSelect({ groups, label, prefix, icon = "cpu", disabled = false, debugState }: GroupSelectProps) {
  const entries: MenuEntry[] = groups.flatMap((g, i) => [
    ...(i > 0 ? (["separator"] as const) : []),
    { group: g.label },
    ...g.options.map((o) => ({
      label: o.label,
      checked: o.value === g.value,
      disabled: o.disabled,
      onSelect: () => g.onChange(o.value),
    })),
  ]);
  return (
    <span {...stylex.props(styles.wrap)}>
      {prefix && (
        <span aria-hidden="true" {...stylex.props(styles.prefix)}>
          {prefix}
        </span>
      )}
      <Menu
        label={label}
        entries={entries}
        debugState={debugState}
        trigger={
          <Button
            variant="quiet"
            size="sm"
            icon={icon}
            iconAfter="chevron-down"
            label={groups.map(shownOf).join(" · ")}
            disabled={disabled}
          />
        }
      />
    </span>
  );
}
