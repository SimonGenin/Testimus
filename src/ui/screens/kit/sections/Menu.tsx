import { Button } from "../../../components/ui/Button.tsx";
import { Menu, type MenuEntry } from "../../../components/ui/Menu.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const more: MenuEntry[] = [
  { label: "Clone", icon: "copy", hint: "saves first", onSelect: () => {} },
  { label: "Download from Jira", icon: "download", onSelect: () => {} },
  { label: "Undo local changes", icon: "undo", hint: "1 modified step", onSelect: () => {} },
  {
    label: "Open in Jira",
    icon: "external",
    disabled: "Only for a test that has a Jira key",
    onSelect: () => {},
  },
  "separator",
  { label: "Delete local copy", icon: "trash", danger: true, onSelect: () => {} },
];

const sort: MenuEntry[] = [
  { group: "Sort" },
  { label: "Newest first", checked: true, onSelect: () => {} },
  { label: "Key", checked: false, onSelect: () => {} },
  { label: "Title", checked: false, onSelect: () => {} },
  { group: "Show" },
  { label: "Only To fix", checked: false, onSelect: () => {} },
  { note: "Tests without a key come last." },
];

const project: MenuEntry[] = [
  {
    label: "LFRPS12",
    icon: "folder",
    description: "~/Projets/LFRPS12 · 12 tests",
    checked: true,
    onSelect: () => {},
  },
  { label: "BHPTCC", icon: "folder", description: "~/Projets/BHPTCC · 3 tests", checked: false, onSelect: () => {} },
  "separator",
  { label: "Open another project…", icon: "folder-open", shortcut: "Ctrl O", onSelect: () => {} },
  { label: "Settings", icon: "settings", shortcut: "Ctrl ,", onSelect: () => {} },
];

export const section: KitSection = {
  name: "Menu",
  family: "Overlays",
  file: "Menu.tsx",
  summary:
    "A short list of actions (⋯ More actions, the project menu) or of choices (sort, filter) on a Button. The destructive item is last, red, behind its own separator, and always confirms; a disabled item stays visible with its reason.",
  note: "Keyboard: arrows (wrapping), Home and End, type-ahead on the first letters, Enter or Space acts, Escape and Tab close and give the focus back to the trigger. Anchored like Popover (layer.ts) but a separate component: a menu moves the focus between its items, a popover lets Tab move through its fields.",
  states: () => (
    <States>
      <Cell label="closed (the trigger)">
        <Menu trigger={<Button variant="quiet" iconOnly icon="more" label="More actions" />} entries={more} />
        <Menu trigger={<Button variant="quiet" label="Sort" iconAfter="chevron-down" />} entries={sort} />
      </Cell>
      <Cell label="actions · hint · disabled reason · separator · danger" wide column>
        <Menu
          trigger={<Button variant="quiet" iconOnly icon="more" label="More actions for this test" />}
          entries={more}
          debugState="open"
        />
      </Cell>
      <Cell label="item hovered or focused" wide column>
        <Menu
          trigger={<Button variant="quiet" iconOnly icon="more" label="More actions, hovered" />}
          entries={more}
          debugState="open"
          debugActive="Undo local changes"
        />
      </Cell>
      <Cell label="danger hovered" wide column>
        <Menu
          trigger={<Button variant="quiet" iconOnly icon="more" label="More actions, danger hovered" />}
          entries={more}
          debugState="open"
          debugActive="Delete local copy"
        />
      </Cell>
      <Cell label="choices: groups · checked · note" wide column>
        <Menu
          trigger={<Button variant="quiet" label="Sort" iconAfter="chevron-down" />}
          label="Sort and show"
          entries={sort}
          debugState="open"
          debugActive="Key"
        />
      </Cell>
      <Cell label="second line · keys · aligned on the end" wide column>
        <Menu
          trigger={<Button variant="quiet" icon="folder" label="LFRPS12" iconAfter="chevron-down" />}
          label="Projects"
          entries={project}
          align="end"
          debugState="open"
        />
      </Cell>
    </States>
  ),
};
