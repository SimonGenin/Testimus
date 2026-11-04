import { Button } from "../../../components/ui/Button.tsx";
import { EmptyState } from "../../../components/ui/EmptyState.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "EmptyState",
  family: "Feedback",
  file: "EmptyState.tsx",
  summary:
    "Fills a list or a pane that has nothing: a mark, what is missing, how to fill it, at most two buttons — the first is the way forward. No illustration, no joke.",
  note: "Added to the N2 list on purpose: every screen had its own empty pane (No document yet, No test yet, Nothing to review, No job yet).",
  guidelines: [],
  states: () => (
    <States>
      <Cell label="with actions" wide column>
        <EmptyState
          icon="documents"
          title="No document yet"
          text="Add the specifications your tests come from: .docx or .pdf."
          actions={
            <>
              <Button variant="primary" icon="plus" label="Add documents" />
              <Button label="Add from a path…" />
            </>
          }
        />
      </Cell>
      <Cell label="text only" column>
        <EmptyState icon="review" title="Nothing to review" text="Tests land here once the check has run on them." />
      </Cell>
      <Cell label="compact (inside a list)" column>
        <EmptyState compact icon="jobs" title="No job yet" />
      </Cell>
    </States>
  ),
};
