import { Disclosure } from "../../../components/ui/Disclosure.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Disclosure",
  family: "Navigation",
  file: "Disclosure.tsx",
  summary:
    "Folds a part of a pane behind its summary: « Technical details », « Sources read », « What Claude did ». The summary is a button that says whether it is open and which region it opens.",
  note: "Added to the kit on purpose (the screens' fifteen hand-made folds and <details>): its trigger is its own small button until Button has an expanded option.",
  states: () => (
    <States>
      <Cell label="closed · meta" column>
        <Disclosure summary="Technical details" meta="3 lines">
          exit 1
        </Disclosure>
      </Cell>
      <Cell label="open" column>
        <Disclosure summary="Sources read" meta="4" defaultOpen>
          <span>SOSIE_211_D401-1_4#5.6.2 « Le sectionneur s'ouvre… »</span>
        </Disclosure>
      </Cell>
      <Cell label="count" column>
        <Disclosure summary="Not covered" count={2} countTone="warning">
          …
        </Disclosure>
      </Cell>
      <Cell label="quiet" column>
        <Disclosure summary="Raw output" quiet>
          …
        </Disclosure>
      </Cell>
      <Cell label="hover · focus" column>
        <Disclosure summary="What Claude did" debugState="hover">
          …
        </Disclosure>
        <Disclosure summary="What Claude did" debugState="focus">
          …
        </Disclosure>
      </Cell>
    </States>
  ),
};
