import { Button, type ButtonVariant } from "../../../components/ui/Button.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const VARIANTS: ButtonVariant[] = ["primary", "secondary", "quiet", "danger", "claude", "claude-quiet"];

export const section: KitSection = {
  name: "Button",
  family: "Actions",
  file: "Button.tsx",
  summary:
    "The one button: every clickable action that is not a link, a chip, a tab or a menu item. At most one primary per region; danger only to confirm a destructive dialog; claude when Claude will act.",
  guidelines: [
    {
      head: "Anatomy",
      text: "Optional leading icon (16 px) or spinner · label (13 px medium) · optional count · optional trailing chevron · optional shortcut (`kbd`, a tinted pill). Height 32 px (`size-control-md`), 14 px side padding, radius `radius-2` (8 px).",
    },
    {
      head: "Variants",
      items: [
        "`primary` — the one action the screen exists for (Push to Jira, Generate, Validate, Save and test). **At most one per screen region** (a pane, a dialog). Fill `color-accent`, label `color-on-accent`.",
        "`secondary` (default) — every other action that deserves a box: Cancel, Show changes, Reindex. White ground, a light `color-border-field` edge and `shadow-0`; filled buttons add a 1 px inner highlight.",
        "`quiet` — toolbar and row actions, secondary actions in dense places (Insert below, Hide details, Clone). No edge until hovered.",
        "`danger` — only the confirm button of a destructive dialog (Delete, Overwrite local, Drop). A destructive *entry point* is a red menu item, never a red button on a screen.",
        "`claude` / `claude-quiet` — an action that starts a Claude run (Send, Ask Claude, Ask Claude to fix it). Violet means « Claude will act ».",
        "`iconOnly` — square; always has an accessible label shown as tooltip.",
      ],
    },
    {
      head: "Sizes",
      text: "`sm` 28 px (inside cards, rows, toasts, the dock's footer) · `md` 32 px (default) · `lg` 40 px (first launch, empty states' main action) · `xs` 24 px for icon-only row actions.",
    },
    {
      head: "States",
      text: "default · hover · pressed · focus (2 px `color-focus-ring`, offset 2 px) · disabled (sunken fill, disabled text, no edge; the reason goes in a tooltip: « Claude is working — wait for it to finish ») · loading (spinner replaces the icon, label stays, `aria-busy`).",
    },
    {
      head: "Rules",
      text: "Labels are verbs in sentence case (« Push to Jira », not « Push »). A timed action shows its countdown in the label: « Undo · 5 s ». A shortcut is shown as `kbd` only on the primary action of a screen (Validate `V`). Never two primary buttons side by side; never a danger button outside a confirmation; never an icon-only button without a label.",
    },
  ],
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
      <Cell label="field (the palette's sunken pill) · hover" wide column>
        <Button variant="field" icon="search" label="Search tests, documents, commands…" shortcut="Ctrl K" block />
        <Button
          variant="field"
          icon="search"
          label="Search tests, documents, commands…"
          shortcut="Ctrl K"
          block
          debugState="hover"
        />
      </Cell>
      <Cell label="link (inside a sentence or a value)" wide>
        <span>
          Validated tests are kept. To keep one, <Button variant="link" label="validate it in Review first" />.
        </span>
        <Button variant="link" label="§ 5.6" debugState="hover" />
      </Cell>
      <Cell label="block" wide>
        <Button variant="primary" size="lg" label="Open the project" block />
      </Cell>
    </States>
  ),
};
