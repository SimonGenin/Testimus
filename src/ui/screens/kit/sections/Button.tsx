import { Button, type ButtonVariant } from "../../../components/ui/Button.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "quiet", "danger", "claude", "claude-quiet"];

export const section: KitSection = {
  name: "Button",
  family: "Actions",
  file: "Button.tsx",
  summary:
    "The one button: every clickable action that is not a link, a chip, a tab or a menu item. At most one primary per region; danger only to confirm a destructive dialog; claude when Claude will act.",
  states: () => (
    <States>
      {VARIANTS.map((v) => (
        <Cell key={v} label={v}>
          <Button variant={v} label="Push to Jira" icon={v.startsWith("claude") ? "claude" : "push"} />
        </Cell>
      ))}
      {(["hover", "pressed", "focus"] as const).map((d) => (
        <Cell key={d} label={`primary ${d}`}>
          <Button variant="primary" label="Validate" debugState={d} />
          <Button label="Cancel" debugState={d} />
        </Cell>
      ))}
      <Cell label="quiet hover · quiet disabled">
        <Button variant="quiet" label="Hide details" debugState="hover" />
        <Button variant="quiet" label="Clone" disabled />
      </Cell>
      <Cell label="sizes xs · sm · md · lg">
        <Button size="xs" label="xs" />
        <Button size="sm" label="Small" />
        <Button label="Medium" />
        <Button size="lg" label="Large" />
      </Cell>
      <Cell label="icon only (label in a tooltip)">
        <Button iconOnly size="xs" variant="quiet" icon="trash" label="Delete step" />
        <Button iconOnly size="sm" variant="quiet" icon="more" label="More" />
        <Button iconOnly icon="sync" label="Pull from Jira" />
        <Button iconOnly size="lg" variant="claude" icon="claude" label="Ask Claude" />
      </Cell>
      <Cell label="disabled (with its reason) · loading">
        <Button variant="primary" label="Push to Jira" disabled="Claude is working — wait for it to finish" />
        <Button label="Pulling" icon="download" loading />
      </Cell>
      <Cell label="count · shortcut · trailing chevron · countdown">
        <Button label="Review" count={12} />
        <Button variant="primary" label="Validate" shortcut="V" />
        <Button variant="quiet" label="Folder" iconAfter="chevron-down" />
        <Button size="sm" variant="quiet" label="Undo · 5 s" icon="undo" />
      </Cell>
      <Cell label="toggle · menu trigger" column>
        <Button variant="quiet" icon="layout-stacked" label="Stacked" pressed />
        <Button variant="quiet" icon="more" iconOnly label="Test actions" popup={{ kind: "menu", open: false }} />
      </Cell>
      <Cell label="block" wide>
        <Button variant="primary" size="lg" label="Open the project" block />
      </Cell>
    </States>
  ),
};
