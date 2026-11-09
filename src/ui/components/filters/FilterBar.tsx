import * as stylex from "@stylexjs/stylex";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Text } from "../ui/Text.tsx";
import { type } from "../ui/type.ts";
import { FilterMenu, type FilterMenuProps } from "./FilterMenu.tsx";

const styles = stylex.create({
  bar: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  menus: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: space.s1, minWidth: 0 },
  shown: { display: "flex", alignItems: "center", gap: space.s2, minHeight: space.s6, color: color.textMuted },
  grow: { flex: 1 },
});

export type FilterBarProps = {
  /** what the words are matched against, said in the box (« Filter — summary or key ») */
  placeholder: string;
  /** the box's accessible name (« Filter the queue ») */
  label: string;
  words: string;
  onWords: (words: string) => void;
  /** one menu per dimension; a dimension with fewer than two values is left out */
  menus: (FilterMenuProps & { key: string })[];
  /** how many the filters keep, of how many — said only while a filter is on */
  shown: number;
  total: number;
  /** every filter off */
  onClear: () => void;
};

// ponytail: the one filter bar above a list that narrows (New run's tests, Review's queue, the runs): words, a menu per
// dimension (ticks add up inside one, menus narrow each other), and « n of m shown » with Clear while one is on. The
// sort is the list's own, in its head
export function FilterBar(p: FilterBarProps) {
  const menus = p.menus.filter((m) => m.options.length > 1 || m.selected.length > 0);
  const on = !!p.words.trim() || menus.some((m) => m.selected.length > 0);
  return (
    <div {...stylex.props(styles.bar)}>
      <Text
        type="search"
        size="sm"
        icon="filter"
        ariaLabel={p.label}
        placeholder={p.placeholder}
        value={p.words}
        onChange={p.onWords}
      />
      {menus.length > 0 && (
        <div {...stylex.props(styles.menus)}>
          {menus.map(({ key, ...m }) => (
            <FilterMenu key={key} {...m} />
          ))}
        </div>
      )}
      {on && (
        <div role="status" {...stylex.props(type.small, styles.shown)}>
          <span>
            {p.shown} of {p.total} shown
          </span>
          <span {...stylex.props(styles.grow)} />
          <Button size="sm" variant="link" label="Clear the filters" onClick={p.onClear} />
        </div>
      )}
    </div>
  );
}
