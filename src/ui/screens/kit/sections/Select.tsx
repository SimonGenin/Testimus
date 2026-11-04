import { Select } from "../../../components/ui/Select.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const folders = [
  { value: "/", label: "/" },
  { value: "/Sectionneur", label: "/Sectionneur" },
  { value: "/Sectionneur/Ouverture", label: "/Sectionneur/Ouverture" },
];
const sorts = [
  { value: "newest", label: "Newest" },
  { value: "key", label: "Key" },
];
const models = [
  { value: "haiku", label: "Haiku", hint: "Fast, for short asks and checks." },
  { value: "sonnet", label: "Sonnet", hint: "The default: writes and fixes tests." },
  { value: "opus", label: "Opus", hint: "Slow and thorough, for a whole document." },
];

export const section: KitSection = {
  name: "Select",
  family: "Inputs",
  file: "Select.tsx",
  summary:
    "One value from a short, known list (folder, model · effort, sort). More than about twelve values or free text is a Text with suggestions; two values are a Segmented choice or a Switch.",
  guidelines: [
    {
      head: "Options",
      text: "`boxed` (forms) or `quiet` (toolbars, the dock footer, the queue's sort) · `sm` | `md` · `prefix` (« Sort », « Folder ») · leading icon · `block` · an option's `hint` (its second line in the open list, and the hint under a labelled select while it is chosen). The open list is the **Menu** (a listbox: the chosen option checked and focused, arrows, type-ahead, Escape) — never the platform's own list. The label shown above is the kit's Field, the same as Text's. **States.** default · hover · focus (accent ring) · open · disabled (with the reason as tooltip) · placeholder (« Choose a folder… »). **Rules.** More than ~12 values or free text → a Text with suggestions (the folder field), not a select. Never use a select for two options: use a Segmented choice or a Switch.",
    },
  ],
  states: () => (
    <States>
      <Cell label="boxed · placeholder · label shown" column>
        <Select
          label="Folder"
          showLabel
          value={null}
          placeholder="Choose a folder…"
          options={folders}
          onChange={() => {}}
          block
        />
      </Cell>
      <Cell label="label shown · option hints (the chosen one under the field)" column>
        <Select label="Model" showLabel value="sonnet" options={models} onChange={() => {}} block />
      </Cell>
      <Cell label="boxed · value · icon" column>
        <Select label="Folder" value="/Sectionneur" options={folders} icon="folder" onChange={() => {}} />
      </Cell>
      <Cell label="quiet · prefix · small">
        <Select label="Sort" appearance="quiet" prefix="Sort" value="newest" options={sorts} onChange={() => {}} />
        <Select label="Effort" appearance="quiet" size="sm" value="key" options={sorts} onChange={() => {}} />
      </Cell>
      <Cell label="hover · focus">
        <Select label="hover" value="key" options={sorts} debugState="hover" onChange={() => {}} />
        <Select label="focus" value="key" options={sorts} debugState="focus" onChange={() => {}} />
      </Cell>
      <Cell label="open: the list is the Menu" column>
        <Select label="Model" value="sonnet" options={models} debugState="open" onChange={() => {}} />
      </Cell>
      <Cell label="disabled with its reason">
        <Select label="Model" value="key" options={sorts} disabled="Claude is working" onChange={() => {}} />
      </Cell>
    </States>
  ),
};
