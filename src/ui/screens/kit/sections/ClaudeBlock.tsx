import * as stylex from "@stylexjs/stylex";
import { ClaudeBlock } from "../../../components/ui/ClaudeBlock.tsx";
import { size, space } from "../../../styles/tokens.stylex.ts";
import { Cell, type KitSection, States } from "../kit.tsx";

const styles = stylex.create({
  dock: { width: `calc(${size.dock} - 2 * ${space.s3})`, maxWidth: "100%" },
  narrow: { width: `calc(${size.dock} - ${space.s10} - 2 * ${space.s3})`, maxWidth: "100%" },
});

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
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ],
  onChange: () => {},
};
const contexts = [
  { id: "glossaire", label: "Glossaire RATP", on: true },
  { id: "regles", label: "Règles de rédaction", on: true },
  { id: "old", label: "Ancien lot", on: false },
];
const quickAsks = [
  { label: "Shorten", prompt: "Make every step shorter." },
  { label: "Negative path", prompt: "Add the negative path." },
];

export const section: KitSection = {
  name: "ClaudeBlock",
  family: "Claude",
  file: "ClaudeBlock.tsx",
  summary:
    "Every place where one writes to or for Claude: the Text component inside a frame that adds contexts, quick asks, model and effort, and send or autosave — never a second text box.",
  note: "Built on Text: a feature added to Text (a shortcut, a mention) works here at once. Attachments are not shown: no Claude run takes a file today.",
  states: () => (
    <States>
      <Cell label="dock — on a test (empty)" wide column>
        <ClaudeBlock
          ariaLabel="Ask Claude on this test"
          value=""
          placeholder="Ask Claude to change this test — or press Send to check it"
          scope="Whole test"
          contexts={contexts}
          onAddContext={() => {}}
          quickAsks={quickAsks}
          model={model}
          effort={effort}
          allowEmpty
          onSubmit={() => {}}
        />
      </Cell>
      <Cell label="the dock's width (424 px, then 360 px): the key hint folds, Send stays whole" wide column>
        {[styles.dock, styles.narrow].map((w, i) => (
          <div key={String(i)} {...stylex.props(w)}>
            <ClaudeBlock
              ariaLabel={`dock width ${i}`}
              value=""
              placeholder="Ask Claude"
              scope="Whole project"
              model={model}
              effort={effort}
              allowEmpty
              onSubmit={() => {}}
            />
          </div>
        ))}
      </Cell>
      <Cell label="typing · focus" wide column>
        <ClaudeBlock
          ariaLabel="typing"
          value="Add a step that checks the refusal message."
          onChange={() => {}}
          scope="Step 2"
          model={model}
          effort={effort}
          debugState="focus"
          onSubmit={() => {}}
        />
      </Cell>
      <Cell label="running" wide column>
        <ClaudeBlock
          ariaLabel="running"
          value="Add the negative path."
          onChange={() => {}}
          scope="Whole test"
          running={47}
          onCancel={() => {}}
          onSubmit={() => {}}
        />
      </Cell>
      <Cell label="ask the documents" wide column>
        <ClaudeBlock
          ariaLabel="Ask the documents"
          value=""
          placeholder="Ask the documents"
          contexts={contexts.slice(0, 1)}
          model={model}
          effort={effort}
          submitLabel="Ask"
          onSubmit={() => {}}
        />
      </Cell>
      <Cell label="unavailable" wide column>
        <ClaudeBlock
          ariaLabel="unavailable"
          value=""
          placeholder="Ask Claude"
          unavailable="Claude is optional — everything else works without it"
          onSubmit={() => {}}
        />
      </Cell>
      <Cell label="Ask Claude on a step (popover)" column>
        <ClaudeBlock
          ariaLabel="step"
          value=""
          plain
          quickAsks={quickAsks}
          model={model}
          effort={effort}
          onSubmit={() => {}}
        />
      </Cell>
      <Cell label="To fix note (autosave)" column>
        <ClaudeBlock
          label="To fix"
          value="The expected result of step 3 does not match § 5.6.6."
          onChange={() => {}}
          submit="autosave"
        />
      </Cell>
      <Cell label="Track ids — Enter asks" column>
        <ClaudeBlock
          ariaLabel="track"
          value=""
          placeholder="What should Testimus pick out?"
          submit="enter"
          submitLabel="Ask Claude"
          onSubmit={() => {}}
          plain
        />
      </Cell>
    </States>
  ),
};
