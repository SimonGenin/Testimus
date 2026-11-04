import type { IconName } from "./Icon.tsx";
import { Menu, type MenuEntry } from "./Menu.tsx";
import { type SelectOption, SelectTrigger } from "./Select.tsx";
import { Tooltip } from "./Tooltip.tsx";

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
  const field = (
    <Menu
      label={label}
      entries={entries}
      debugState={debugState}
      trigger={
        <SelectTrigger
          label={label}
          shown={groups.map(shownOf).join(" · ")}
          appearance="quiet"
          size="sm"
          icon={icon}
          prefix={prefix}
          disabled={disabled !== false}
        />
      }
    />
  );
  return typeof disabled === "string" ? <Tooltip label={disabled}>{field}</Tooltip> : field;
}
