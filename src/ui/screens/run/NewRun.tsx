import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { execute } from "../../lib/data/query.ts";
import { message, plural } from "../../lib/format.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { TestPicker } from "./TestPicker.tsx";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s5 },
});

// ponytail: a new run — its name, then its tests picked in the project's tree (a folder at once or one by one, the filter
// bar narrowing what the tree shows); they are frozen in the tree's order
export function NewRun({ onClose, onMade }: { onClose: () => void; onMade: (slug: string) => void }) {
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [tests, setTests] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await execute(client, "runs.create", { name, tests }, { invalidates: [["runs.list"]] });
      if (out.slug) onMade(out.slug);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const count = tests.length;
  const why = !name.trim() ? "Name the run first" : !count ? "Pick the tests to run" : false;
  return (
    <Modal
      title="New run"
      subtitle="A frozen copy of the tests, as they are now: a tester plays them one by one, OK or NOK on each step."
      size="lg"
      onClose={onClose}
      busy={busy}
      error={error}
      onSubmit={() => !why && void make()}
      actions={
        <>
          <Button label="Cancel" onClick={onClose} disabled={busy} />
          <Button
            variant="primary"
            type="submit"
            label={count ? `Make the run (${plural(count, "test")})` : "Make the run"}
            loading={busy}
            disabled={why}
          />
        </>
      }
    >
      <div {...stylex.props(styles.body)}>
        <Text label="Name" value={name} onChange={setName} placeholder="Recette J5 — Sectionneurs" autoFocus />
        <Field
          label="Tests"
          hint="Tick a folder for all its tests, or the tests one by one. What the filters hide stays picked."
        >
          <TestPicker onChange={setTests} />
        </Field>
      </div>
    </Modal>
  );
}
