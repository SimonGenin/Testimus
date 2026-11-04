import { useId, useState } from "react";
import { type Tab, TabPanel, Tabs } from "../../../components/ui/Tabs.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

type V = "local" | "jira";
const LIST: Tab<V>[] = [
  { value: "local", label: "Local", count: 12, icon: "file" },
  { value: "jira", label: "Jira", count: 645, icon: "cloud" },
];

type D = "documents" | "test" | "actions" | "later";
const DOCK: Tab<D>[] = [
  { value: "documents", label: "Documents" },
  { value: "test", label: "This test" },
  { value: "actions", label: "Actions", count: 2 },
  { value: "later", label: "Jira", disabled: "Connect Jira first" },
];

type S = "access" | "project" | "pack";
const STEPS: Tab<S>[] = [
  { value: "access", label: "Access" },
  { value: "project", label: "Project" },
  { value: "pack", label: "Search pack" },
];

function Live() {
  const [v, setV] = useState<V>("local");
  const id = useId();
  return (
    <>
      <Tabs label="Test list" value={v} tabs={LIST} onChange={setV} panelId={id} />
      <TabPanel panelId={id} value={v}>
        {v === "local" ? "12 local tests" : "645 tests in Jira"}
      </TabPanel>
    </>
  );
}

function Steps({ at }: { at: S }) {
  const [v, setV] = useState<S>(at);
  return <Tabs variant="steps" label="Setup steps" value={v} tabs={STEPS} onChange={setV} />;
}

export const section: KitSection = {
  name: "Tabs",
  family: "Navigation",
  file: "Tabs.tsx",
  summary:
    "Views of one thing: Local / Jira, the dock's scope, a document's Text / Figures. Tabs never trigger an action; more than six means the content needs another structure. The arrows move and open.",
  note: "variant steps is the first launch's stepper drawn by the screens: a row of numbered views, the current one marked, the earlier ones done — one component with an option, not a second one.",
  guidelines: [],
  states: () => (
    <States>
      <Cell label="md · icons · counts (with its panel)" wide column>
        <Live />
      </Cell>
      <Cell label="sm · fill · disabled with its reason" wide column>
        <Tabs label="Dock scope" size="sm" fill value="test" tabs={DOCK} onChange={() => {}} />
      </Cell>
      <Cell label="hover · focus" wide column>
        <Tabs
          label="Hover"
          value="local"
          tabs={LIST}
          onChange={() => {}}
          debugState={{ value: "jira", state: "hover" }}
        />
        <Tabs
          label="Focus"
          value="local"
          tabs={LIST}
          onChange={() => {}}
          debugState={{ value: "jira", state: "focus" }}
        />
      </Cell>
      <Cell label="steps · first, middle, last" wide column>
        <Steps at="access" />
        <Steps at="project" />
        <Steps at="pack" />
      </Cell>
    </States>
  ),
};
