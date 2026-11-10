import { Toast } from "../../../components/ui/Toast.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const none = () => {};

export const section: KitSection = {
  name: "Toast",
  family: "Feedback",
  file: "Toast.tsx",
  summary:
    "The result of something that happened away from the eyes: a pull landed, a reload from disk, a delete with Undo. toast({ … }) from anywhere; Toaster stacks them bottom right, three at most, the newest at the bottom. Never for a save (Text shows it), never the only trace of an error that blocks work (that is a Banner).",
  note: "A danger toast is an alert and stays until dismissed; the others are a status and leave after 6 s (or `seconds`). An action closes its toast; its time limit counts down in its label. onExpire runs when a toast leaves without its action (an Undo commits there).",
  guidelines: [],
  states: () => (
    <States>
      <Cell label="the stack: success · neutral + Undo · warning · danger + Retry · claude" wide column>
        <Toast tone="success" title="LFRPS12-1398 pulled" text="5 steps · 2 images" onDismiss={none} />
        <Toast title="Step 3 deleted" action={{ label: "Undo", onAction: none }} left={5} onDismiss={none} />
        <Toast tone="warning" title="Reloaded from disk" text="test.md changed outside Testimus." onDismiss={none} />
        <Toast
          tone="danger"
          title="Pull failed — LFRPS12-1398"
          text="Jira refused the request (403). Check Settings › Jira and Xray."
          action={{ label: "Retry", onAction: none }}
          onDismiss={none}
        />
        <Toast
          tone="claude"
          title="Generate tests finished"
          text="6 tests written · 2 requirements not covered"
          action={{ label: "Review", onAction: none }}
          onDismiss={none}
        />
      </Cell>
      <Cell label="title only" wide column>
        <Toast title="Smart columns read again from Xray" onDismiss={none} />
      </Cell>
      <Cell label="long text" wide column>
        <Toast
          tone="warning"
          title="EXI_MOP_SPF_511_A_1650_and_a_very_long_requirement_identifier not found"
          text="The passage moved when the document was converted again; its anchor §5.6.6 still points at the old text, so the source of step 2 needs a look."
          onDismiss={none}
        />
      </Cell>
    </States>
  ),
};
