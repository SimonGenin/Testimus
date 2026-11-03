import { Banner } from "../../../components/ui/Banner.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Tooltip } from "../../../components/ui/Tooltip.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Banner",
  family: "Feedback",
  file: "Banner.tsx",
  summary:
    "A notice that belongs to a place on the screen and stays while it is true. One per region, the most serious wins. Never for a passing result (that is a toast).",
  note: "Added to the N2 list on purpose: many screens need it, and before it was drawn five different ways.",
  states: () => (
    <States>
      {(["info", "success", "warning", "danger", "claude", "neutral"] as const).map((t) => (
        <Cell key={t} label={t} column>
          <Banner tone={t} title={t === "danger" ? "Jira did not answer" : undefined}>
            {t === "warning" ? "Index not up to date — 2 documents changed since." : "Search on words only."}
          </Banner>
        </Cell>
      ))}
      <Cell label="with actions" wide column>
        <Banner tone="warning" title="Changed in Jira" actions={<Button size="sm" label="Compare with Jira" />}>
          This test changed in Jira since your last pull.
        </Banner>
      </Cell>
      <Cell label="compact" column>
        <Banner tone="claude" compact>
          Claude changed 1 step.
        </Banner>
      </Cell>
      <Cell label="tooltip (focus the button)">
        <Tooltip label="Open in Jira" shortcut="O">
          <Button variant="quiet" label="Jira" icon="external" />
        </Tooltip>
      </Cell>
    </States>
  ),
};
