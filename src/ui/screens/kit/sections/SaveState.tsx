import { SaveState } from "../../../components/ui/SaveState.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "SaveState",
  family: "Feedback",
  file: "SaveState.tsx",
  summary:
    "Where the last edit stands, as a quiet word beside a label or in the editor's bar: Edited, Saving…, Saved, Not saved with Retry, Changed on disk, Claude is editing. Never a toast.",
  note: "Text shows it by itself for a field bound to a save; a screen uses it for a whole document (the test editor's bar), with `activity` for work that holds the document and is not a save (« Refreshing from Jira… »).",
  guidelines: [
    {
      head: "States",
      items: [
        "**Edited · saves in a moment** — a save is pending; shown only after 1 s.",
        "**Saving…** — a spinner.",
        "**Saved** — a quiet check, the time in the tooltip (`at`); with `fade` (inline fields) it goes after 3 s.",
        "**Not saved** — danger, with Retry (`onRetry`); the text is kept.",
        "**Changed on disk** — warning; the field shows Reload from disk and Keep mine under it.",
        "**Claude is editing** — violet, a lock; read-only until the run ends (the tooltip says so).",
      ],
    },
  ],
  states: () => (
    <States>
      <Cell label="pending: Edited · saves in a moment">
        <SaveState status="pending" debugState="late" />
      </Cell>
      <Cell label="saving">
        <SaveState status="saving" />
      </Cell>
      <Cell label="saved (time in the tooltip)">
        <SaveState status="saved" at="10:42" />
      </Cell>
      <Cell label="error · Retry">
        <SaveState status="error" onRetry={() => {}} />
      </Cell>
      <Cell label="conflict">
        <SaveState status="conflict" />
      </Cell>
      <Cell label="claude">
        <SaveState status="claude" />
      </Cell>
      <Cell label="activity (over the status)">
        <SaveState status="saved" activity="Refreshing from Jira…" />
      </Cell>
    </States>
  ),
};
