import { Button } from "../../../components/ui/Button.tsx";
import { type SaveState, Text } from "../../../components/ui/Text.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

const noop = async () => {};
const state = (status: SaveState["status"], error?: string): SaveState => ({
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
      <Cell label="Changed on disk" column>
        <Text label="Project notes" multiline value="Mine" autosave={state("conflict")} onChange={() => {}} />
      </Cell>
      <Cell label="Read-only — Claude is editing" column>
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
