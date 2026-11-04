import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.tsx";
import { ResizeHandle } from "../../../components/ui/ResizeHandle.tsx";
import { type FieldAutosave, Text } from "../../../components/ui/Text.tsx";
import { space } from "../../../styles/tokens.stylex.ts";
import { Cell, type KitSection, States } from "../kit.tsx";

const styles = stylex.create({
  resizable: { display: "flex", gap: space.s3, width: "100%" },
  pane: { flex: "none", minWidth: 0 },
});

function Resizable({ text }: { text: string }) {
  const [px, setPx] = useState(240);
  return (
    <div {...stylex.props(styles.resizable)}>
      <div {...stylex.props(styles.pane)} style={{ width: px }}>
        <Text label="Expected result" multiline value={text} onChange={() => {}} />
      </div>
      <ResizeHandle label="Field width" value={px} min={160} max={480} defaultValue={240} onChange={setPx} />
    </div>
  );
}

const noop = async () => {};
const state = (status: FieldAutosave["status"], error?: string): FieldAutosave => ({
  status,
  error,
  flush: noop,
  retry: noop,
  keepMine: noop,
  takeDisk: () => {},
});
const LONG =
  "Vérifier que le menu contextuel du sectionneur propose « Ouvrir » et « Fermer » selon le type de sectionneur, et que la commande refusée affiche le motif dans la barre d'état sans modifier l'état du poste.";

export const section: KitSection = {
  name: "Text",
  family: "Inputs",
  file: "Text.tsx",
  summary:
    "The only editable text: single line or growing, saved by itself (autosave of the data layer), showing where its value stands. A chip field, the Claude block and a table cell are this component with options.",
  guidelines: [
    {
      head: "Anatomy",
      text: "Optional label (13 px medium, in the text colour) with the save state at its right · the field · optional error line · optional hint. Inside the field: optional leading icon, the value, optional trailing content (a unit, a Browse… button, a Show/Hide for secrets).",
    },
    {
      head: "Options",
      items: [
        "`multiline` — grows from 3 lines with its content, never scrolls inside itself (the pane scrolls).",
        "`appearance`: `boxed` (forms, dialogs, settings) or `inline` (the step editor: no edge until hovered or focused, so a test reads as a document).",
        "`size`: `md` (14 px) or `sm` (13 px, dense rows and table cells) · `title` (the test summary: 16 px semibold, single line).",
        "`save`: a command; the component calls it 400 ms after the last key, on blur, on window blur and on unmount. A field without `save` is a plain form field submitted by its dialog.",
      ],
    },
    {
      head: "Save states",
      text: "(the SaveState word beside the label, or at the bottom-right of an inline block; never a toast):",
      items: [
        "**Edited · saves in a moment** — typing, the save is pending (shown only after 1 s).",
        "**Saving…** — spinner.",
        "**Saved** — quiet check; the time in the tooltip. Fades to nothing after 3 s in inline fields.",
        "**Not saved — Retry** — danger, the field keeps the text, Retry calls save again; leaving the screen keeps the draft.",
        "**Changed on disk** — warning; a banner under the field offers « Reload from disk » and « Keep mine ».",
        "**Claude is editing** — violet edge and ground, lock (the tooltip says it is read-only); the value cannot be typed in until the run ends.",
      ],
    },
    {
      head: "States",
      text: "default · hover · focus (1 px accent edge + 4 px soft accent halo) · placeholder · disabled · error (danger edge, message below, `aria-invalid`) · read-only (sunken ground, no edge).",
    },
    {
      head: "Rules",
      text: "A placeholder is an example, never the label. A draft survives a screen change. Errors say what to do (« Use an absolute path »). Don't build another text box: a chip field, the Claude block and a table cell are this component with options.",
    },
  ],
  states: () => (
    <States>
      <Cell label="boxed · label · placeholder" column>
        <Text label="Jira project key" value="" placeholder="LFRPS12" onChange={() => {}} />
      </Cell>
      <Cell label="filled · hint" column>
        <Text label="Label prefix" value="testimus-" hint="Added before the review state in Jira" onChange={() => {}} />
      </Cell>
      <Cell label="hover · focus" column>
        <Text ariaLabel="hover" value="Hovered" debugState="hover" onChange={() => {}} />
        <Text ariaLabel="focus" value="Focused" debugState="focus" onChange={() => {}} />
      </Cell>
      <Cell label="error" column>
        <Text label="claude.exe" value="claude" error="Use an absolute path" icon="terminal" onChange={() => {}} />
      </Cell>
      <Cell label="disabled · read-only" column>
        <Text ariaLabel="disabled" value="Off" disabled onChange={() => {}} />
        <Text ariaLabel="read-only" value="From Jira" readOnly onChange={() => {}} />
      </Cell>
      <Cell label="small · title" column>
        <Text ariaLabel="small" size="sm" value="Dense row" onChange={() => {}} />
        <Text ariaLabel="title" title value="Sectionneur — ouverture refusée" onChange={() => {}} />
      </Cell>
      <Cell label="secret with a trailing button" column>
        <Text
          label="API token"
          type="password"
          value="secret"
          trailing={<Button size="xs" variant="quiet" label="Show" />}
          onChange={() => {}}
        />
      </Cell>
      <Cell label="multiline, growing (very long text)" wide column>
        <Text label="Description" multiline value={LONG} onChange={() => {}} />
      </Cell>
      <Cell label="multiline, its height follows its width (drag the edge)" wide column>
        <Resizable text={LONG} />
      </Cell>
      <Cell label="inline (the step editor)" wide column>
        <Text
          ariaLabel="inline"
          appearance="inline"
          multiline
          value="Ouvrir le menu contextuel du sectionneur."
          onChange={() => {}}
        />
        <Text
          ariaLabel="inline hover"
          appearance="inline"
          value="Hovered inline"
          debugState="hover"
          onChange={() => {}}
        />
      </Cell>
      <Cell label="Edited · Saving… · Saved" column>
        <Text label="Pending" value="a" autosave={state("pending")} onChange={() => {}} />
        <Text label="Saving" value="ab" autosave={state("saving")} onChange={() => {}} />
        <Text label="Saved" value="abc" autosave={state("saved")} onChange={() => {}} />
      </Cell>
      <Cell label="Not saved — Retry" column>
        <Text label="Notes" value="Kept while it fails" autosave={state("error", "disk full")} onChange={() => {}} />
      </Cell>
      <Cell label="password: Show / Hide in the field" column>
        <Text label="API token" type="password" value="ATATT3xFfGF0" onChange={() => {}} />
      </Cell>
      <Cell label="search: the kit's own clear, and Escape" column>
        <Text ariaLabel="Filter" type="search" icon="filter" value="disjoncteur" onChange={() => {}} />
      </Cell>
      <Cell label="Changed on disk" column>
        <Text label="Project notes" multiline value="Mine" autosave={state("conflict")} onChange={() => {}} />
      </Cell>
      <Cell label="Claude is editing (read-only)" column>
        <Text
          label="Expected Result"
          multiline
          value="Le poste affiche le motif."
          lockedBy="claude"
          onChange={() => {}}
        />
      </Cell>
    </States>
  ),
};
