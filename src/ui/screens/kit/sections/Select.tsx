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

export const section: KitSection = {
  name: "Select",
  family: "Inputs",
  file: "Select.tsx",
  summary:
    "One value from a short, known list (folder, model · effort, sort). More than about twelve values or free text is a Text with suggestions; two values are a Segmented choice or a Switch.",
  guidelines: [
    {
      head: "Options",
      text: "`boxed` (forms) or `quiet` (toolbars, the dock footer, the queue's sort) · `sm` | `md` · `prefix` (« Sort », « Folder ») · leading icon · `block`. **States.** default · hover · focus/open (accent ring) · disabled (with the reason as tooltip) · placeholder (« Choose a folder… »). **Rules.** More than ~12 values or free text → a Text with suggestions (the folder field), not a select. Never use a select for two options: use a Segmented choice or a Switch.",
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
      <Cell label="disabled with its reason">
        <Select label="Model" value="key" options={sorts} disabled="Claude is working" onChange={() => {}} />
      </Cell>
    </States>
  ),
};
