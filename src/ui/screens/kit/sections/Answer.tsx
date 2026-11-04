import { Answer } from "../../../components/ui/Answer.tsx";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Raw } from "../../../components/ui/Raw.tsx";
import { SourceChip } from "../../../components/ui/SourceChip.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const META = "12.3 s · 24k tokens in · 1.2k out · opus / high";

export const section: KitSection = {
  name: "Answer",
  family: "Claude",
  file: "Answer.tsx",
  summary:
    "What Claude says back: an answer in the dock, a run's result card, Claude's reading of a figure, the « Why » of a pattern. Violet ground, the spark and a title, the body, a meta line, the buttons.",
  note: "The design's answer card (kit.mjs answer): the dock, Settings › Columns and the action cards drew it by hand, with other paddings. The request it answers is an Ask.",
  guidelines: [
    {
      head: "Anatomy",
      text: "Head: the spark (an alert when the run failed) and a title (« Claude », « Claude · Step 2 · Add the negative path »), actions at its right · body: paragraphs, source chips, the run's badges, a raw block · meta: small, muted, tabular (« 12.3 s · 24k tokens in ») · foot: Show changes, Revert, Show raw output, Retry.",
    },
    {
      head: "Rules",
      text: "Claude speaks in the first person in the body; the interface never does. `error` is a failed run: say what happened and offer Retry. Violet is for Claude only.",
    },
  ],
  states: () => (
    <States>
      <Cell label="answer · sources · meta · foot" wide column>
        <Answer
          meta={META}
          footer={<Button size="sm" variant="quiet" icon="terminal" label="Show raw output" />}
          actions={<Button size="xs" variant="quiet" icon="copy" iconOnly label="Copy" />}
        >
          <span>
            Le menu contextuel d'un sectionneur dépend de son type : avec TK manœuvré régulièrement, il ne propose que
            Propriétés.
          </span>
          <SourceChip reference="D401-1_3 §5.6.6" quote="Selon le type de sectionneur, le menu contextuel diffère" />
        </Answer>
      </Cell>
      <Cell label="run card · badges · raw shown" wide column>
        <Answer
          title="Claude · Step 2 · Add the negative path"
          meta={META}
          footer={
            <>
              <Button size="sm" icon="eye" label="Show changes" />
              <Button size="sm" icon="undo" label="Revert" />
              <Button size="sm" variant="quiet" icon="terminal" label="Hide raw output" />
            </>
          }
        >
          <span>J'ai ajouté le step 6, avec sa source en §5.6.6.</span>
          <span>
            <Badge label="1 step added" tone="claude" icon="claude" />
          </span>
          <Raw text={"Read tests/LFRPS12-1420/test.md\nEdited step 6"} />
        </Answer>
      </Cell>
      <Cell label="error" wide column>
        <Answer title="The run failed" error footer={<Button size="sm" icon="refresh" label="Retry" />}>
          <span>Claude stopped before the end: the usage limit was reached. Try again in a few minutes.</span>
        </Answer>
      </Cell>
    </States>
  ),
};
