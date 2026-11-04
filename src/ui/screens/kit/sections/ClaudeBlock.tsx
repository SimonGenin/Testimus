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
  guidelines: [
    {
      head: "Anatomy",
      text: "Optional *Context* row (toggle chips: the effective contexts of this run, each switchable off for this run only, + Add context) · optional *Quick asks* row (chips that put their prompt in the box; typing clears the pressed one) · the text · footer: scope (« Step 2 », « Whole test », « Whole project »), model, effort, then the submit area. No attachment: no Claude run takes a file today.",
    },
    {
      head: "Options and where each combination is used",
      text: "Where — contexts — quick asks — model · effort — scope — submit.",
      items: [
        "Dock, on a test, a step or the project — yes — yes — yes — yes — Ctrl+Enter → Send",
        "Dock, ask the documents — yes — no — yes — no — Ctrl+Enter → Ask",
        "« Ask Claude » popover on a test or a step — no (inherits) — yes — yes — no — Ctrl+Enter → Send",
        "« To fix » note (Review) — no — no — no — no — autosave; the dialog's « Mark To fix » / « Ask Claude to fix it »",
        "A context's notes (Contexts dialog) — no — no — no — no — autosave",
        "A quick ask's prompt (Settings › Claude) — no — no — no — no — autosave",
      ],
    },
    {
      head: "States",
      text: "empty (placeholder says what Claude can do here) · typing · focus (violet edge) · running (text read-only, footer violet: spinner, « Claude is working », seconds counter, Cancel) · disabled (Claude not connected: the reason in the footer, Send disabled — « Claude is optional — everything else works without it ») · autosave states from Text.",
    },
    {
      head: "Rules",
      text: "Enter is a new line, Ctrl+Enter sends (the hint is always visible). Model and effort default to the project's, the choice holds for this run. A run on a test or the project may start with an empty box. Violet is reserved for Claude; never use `claude` tones for anything Claude does not do.",
    },
  ],
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
