import { Button } from "../../../components/ui/Button.tsx";
import { ClaudeBlock } from "../../../components/ui/ClaudeBlock.tsx";
import { Icon } from "../../../components/ui/Icon.tsx";
import { Popover } from "../../../components/ui/Popover.tsx";
import { Select } from "../../../components/ui/Select.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const quickAsks = [
  { label: "Rephrase in house style", prompt: "Rephrase step 2 in the house style." },
  { label: "Add the negative path", prompt: "Add the negative path after step 2." },
];
const model = {
  value: "opus",
  options: [
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
  ],
  onChange: () => {},
};
const effort = {
  value: "high",
  options: [
    { value: "low", label: "Low" },
    { value: "high", label: "High" },
  ],
  onChange: () => {},
};
const shows = [
  { value: "open", label: "Open" },
  { value: "filled", label: "When filled" },
  { value: "collapsed", label: "Collapsed" },
];

export const section: KitSection = {
  name: "Popover",
  family: "Overlays",
  file: "Popover.tsx",
  summary:
    "An anchored layer that is not a menu: « Ask Claude » on a step or a test, the activity of running jobs, the step columns, a rich picker. A non-modal dialog with a head, free content and an optional foot.",
  note: "Added to the N2 list on purpose (three hand-made popovers before: ColumnsMenu, the activity popover, FixNote). It shares the anchoring of Menu (layer.ts: fixed position from the trigger, flipped at the window's edge, closed by a press outside) but not its keyboard: the focus goes to its first field, Tab moves through its fields, Escape or Close shut it and give the focus back to the trigger.",
  states: () => (
    <States>
      <Cell label="closed (the trigger)">
        <Popover
          trigger={<Button variant="claude-quiet" size="sm" icon="claude" label="Ask Claude" />}
          title="Ask Claude · Step 2"
          icon="claude"
        >
          Body
        </Popover>
      </Cell>
      <Cell label="md · Ask Claude on a step · flush · foot" wide column>
        <Popover
          trigger={<Button variant="claude-quiet" size="sm" icon="claude" label="Ask Claude" />}
          title="Ask Claude · Step 2"
          icon="claude"
          width="md"
          flush
          align="start"
          foot={
            <>
              <Icon name="info" size="sm" />
              Runs in the dock with this test's contexts
            </>
          }
          debugState="open"
        >
          <ClaudeBlock
            ariaLabel="Ask Claude about step 2"
            value=""
            placeholder="What should change in step 2?"
            scope="Step 2"
            quickAsks={quickAsks}
            model={model}
            effort={effort}
            plain
            onSubmit={() => {}}
          />
        </Popover>
      </Cell>
      <Cell label="sm · a small form (step columns)" wide column>
        <Popover
          trigger={<Button variant="quiet" icon="columns" label="Columns" iconAfter="chevron-down" />}
          title="Step columns"
          width="sm"
          align="start"
          debugState="open"
        >
          <Select label="Data" showLabel value="filled" options={shows} onChange={() => {}} block />
          <Select label="Exigence" showLabel value="open" options={shows} onChange={() => {}} block />
        </Popover>
      </Cell>
      <Cell
        label="sm · a long list: anchored, it is never taller than the room left in the window and its body scrolls (drawn whole here)"
        wide
        column
      >
        <Popover
          trigger={<Button variant="quiet" icon="jobs" label="12 running" />}
          title="Running"
          count={12}
          width="sm"
          debugState="open"
        >
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i}>Convert document · SOSIE_211_D401-1_{i + 1}</span>
          ))}
        </Popover>
      </Cell>
      <Cell label="auto width · end aligned · long text" wide column>
        <Popover trigger={<Button variant="quiet" icon="jobs" label="2 running" />} title="Activity" debugState="open">
          Indexing SOSIE_211_D401-1_3 — 4 of 6 passages, then the figures of Signalisation (about one minute left).
        </Popover>
      </Cell>
    </States>
  ),
};
