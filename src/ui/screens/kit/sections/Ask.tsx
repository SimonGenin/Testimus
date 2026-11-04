import { Ask } from "../../../components/ui/Ask.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Ask",
  family: "Claude",
  file: "Ask.tsx",
  summary:
    "The person's request in a Claude conversation: a sunken bubble on the right, its scope above it. Claude's reply under it is an Answer.",
  note: "The design's .ask with the dock's turn meta (claude.mjs): the dock drew it by hand.",
  guidelines: [
    {
      head: "Rules",
      text: "The words as typed, line breaks kept. A run may start with an empty box: `empty` says what Claude works from instead.",
    },
  ],
  states: () => (
    <States>
      <Cell label="request · its scope" wide column>
        <Ask meta="Step 2 · Whole test">{"Ajoute le cas négatif\nAvec la source en §5.6.7"}</Ask>
      </Cell>
      <Cell label="empty request" wide column>
        <Ask meta="Whole project" empty="No request — Claude works from the scope and the house rules" />
      </Cell>
    </States>
  ),
};
