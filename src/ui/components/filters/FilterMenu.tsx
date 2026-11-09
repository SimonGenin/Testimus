import { Button } from "../ui/Button.tsx";
import type { IconName } from "../ui/Icon.tsx";
import { Menu, type MenuEntry } from "../ui/Menu.tsx";

export type FilterOption = { value: string; label: string; count?: number };

export type FilterMenuProps = {
  /** the dimension it filters (« Folder », « Labels »), the trigger's words while nothing is ticked */
  label: string;
  icon?: IconName;
  options: FilterOption[];
  /** the values kept; none = no filter on this dimension */
  selected: string[];
  onChange: (selected: string[]) => void;
  /** a line under the ticks (what they mean together, where the rest lives) */
  note?: string;
};

const SEARCH_FROM = 9;

// ponytail: one dimension of a filter bar — a quiet button with its name; ticked, it is pressed and says what it keeps
// (« Labels: j5, tk »); its menu holds ticks that stay open, each with how many it holds
export function FilterMenu({ label, icon, options, selected, onChange, note }: FilterMenuProps) {
  const on = options.filter((o) => selected.includes(o.value));
  const words = on.length ? `${label}: ${on.map((o) => o.label.toLowerCase()).join(", ")}` : label;
  const entries: MenuEntry[] = [
    ...options.map((o) => ({
      label: o.label,
      hint: o.count === undefined ? undefined : String(o.count),
      checked: selected.includes(o.value),
      keepOpen: true,
      onSelect: () =>
        onChange(selected.includes(o.value) ? selected.filter((v) => v !== o.value) : [...selected, o.value]),
    })),
    ...(note ? (["separator", { note }] as MenuEntry[]) : []),
  ];
  return (
    <Menu
      label={`Filter by ${label.toLowerCase()}`}
      search={options.length >= SEARCH_FROM ? `Find a ${label.toLowerCase().replace(/s$/, "")}` : undefined}
      trigger={
        <Button
          size="sm"
          variant={on.length ? "secondary" : "quiet"}
          icon={icon}
          iconAfter="chevron-down"
          label={words}
          pressed={on.length > 0}
        />
      }
      entries={entries}
    />
  );
}
