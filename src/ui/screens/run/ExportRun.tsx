import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { execute } from "../../lib/data/query.ts";
import { absolutePath, desktop, examplePath, pickFolder } from "../../lib/desktop.ts";
import { message, plural } from "../../lib/format.ts";
import { space } from "../../styles/tokens.stylex.ts";
import type { RunView } from "./runs.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  text: { margin: 0 },
});

// ponytail: the run as pages — a new folder anyone opens in a browser on any PC; the results so far go with it unless
// the tester starts afresh
export function ExportRun({ run, onClose }: { run: RunView; onClose: () => void }) {
  const client = useQueryClient();
  const [dir, setDir] = useState("");
  const [withResults, setWithResults] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const entered = run.tests.filter((t) => t.result.updatedAt).length;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await execute(
        client,
        "runs.export",
        { run: run.slug, dir, results: withResults },
        { invalidates: "none" },
      );
      setDone(out.dir);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const why = !dir.trim() ? "Give the folder first" : !absolutePath(dir.trim()) ? "Give the folder's full path" : false;
  return (
    <Modal
      title={`Export « ${run.name} » as pages`}
      subtitle="A folder anyone can open in a browser, on any PC — no Testimus needed."
      onClose={onClose}
      busy={busy}
      error={error}
      onSubmit={() => !why && !done && void go()}
      actions={
        done ? (
          <Button variant="primary" label="Done" onClick={onClose} />
        ) : (
          <>
            <Button label="Cancel" onClick={onClose} disabled={busy} />
            <Button variant="primary" type="submit" label="Export" loading={busy} disabled={why} />
          </>
        )
      }
    >
      <div {...stylex.props(styles.body)}>
        <Text
          label="Folder"
          value={dir}
          onChange={setDir}
          spellCheck={false}
          placeholder={examplePath(`D:\\Runs\\${run.slug}`, `/Users/me/Runs/${run.slug}`)}
          hint="A new or empty folder."
          trailing={
            desktop() ? (
              <Button
                size="sm"
                variant="quiet"
                label="Browse…"
                onClick={() => void pickFolder("Export the run to").then((p) => p && setDir(p))}
              />
            ) : undefined
          }
        />
        <p {...stylex.props(type.small, styles.text)}>
          Holds index.html (the run), run.json (the tests and the results), the tests' pictures, start.cmd and start.sh
          (open it on 127.0.0.1) and a README.
        </p>
        <Checkbox
          checked={withResults}
          onChange={setWithResults}
          label={`Include the results already entered (${plural(entered, "test")})`}
        />
        {done && (
          <Banner tone="success" compact>
            The run is in {done}. Copy the folder where the tests are run, open start.cmd, then Import results… here.
          </Banner>
        )}
      </div>
    </Modal>
  );
}
