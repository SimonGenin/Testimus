import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { execute, useRead } from "../../lib/data/query.ts";
import { absolutePath, desktop, examplePath, pickFolder } from "../../lib/desktop.ts";
import { message, plural } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  line: { margin: 0 },
  muted: { margin: 0, color: color.textMuted },
});

const counted = (n: number, word: string) => (n ? plural(n, word) : "");

// ponytail: the results of a run played as pages — what the import will do first (its dry run), then the writing; the
// newer result of a test wins, the older one stays in its history
export function ImportRun({
  run,
  onClose,
  onDone,
}: {
  run?: string;
  onClose: () => void;
  onDone: (run: string) => void;
}) {
  const client = useQueryClient();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const p = path.trim();
  const ok = absolutePath(p);
  const input = { ...(/\.json$/i.test(p) ? { file: p } : { dir: p }), ...(run ? { run } : {}) };
  const plan = useRead("runs.import", { ...input, dryRun: true }, { enabled: ok });
  const d = plan.data;
  const news = d
    ? [
        counted(d.results, "test with a new result") || "no new result",
        counted(d.comments, "comment"),
        counted(d.questions, "question"),
        counted(d.answers, "answer"),
        counted(d.attachments, "screenshot"),
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const nothing =
    !!d && !d.results && !d.comments && !d.questions && !d.answers && !d.attachments && !d.conflicts.length;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await execute(client, "runs.import", input, { invalidates: [["runs.list"], ["runs.show"]] });
      onDone(out.run);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const why = !ok
    ? "Give the folder of the pages first"
    : !d
      ? "Reading the pages…"
      : nothing
        ? "Nothing new to import"
        : false;
  return (
    <Modal
      title="Import the results"
      subtitle={d ? d.source : "From the folder of a run exported as pages, or the run.json its page saved."}
      onClose={onClose}
      busy={busy}
      error={error}
      onSubmit={() => !why && void go()}
      actions={
        <>
          <Button label="Cancel" onClick={onClose} disabled={busy} />
          <Button
            variant="primary"
            type="submit"
            label={d?.results ? `Import ${plural(d.results, "result")}` : "Import"}
            loading={busy}
            disabled={why}
          />
        </>
      }
    >
      <div {...stylex.props(styles.body)}>
        <Text
          label="Folder or run.json"
          value={path}
          onChange={setPath}
          spellCheck={false}
          placeholder={examplePath("D:\\Runs\\recette-j5-sectionneurs", "/Users/me/Runs/recette-j5-sectionneurs")}
          trailing={
            desktop() ? (
              <Button
                size="sm"
                variant="quiet"
                label="Browse…"
                onClick={() => void pickFolder("Import the results from").then((x) => x && setPath(x))}
              />
            ) : undefined
          }
        />
        {plan.error && ok ? (
          <Banner tone="danger" compact>
            {plan.error.message}
          </Banner>
        ) : d ? (
          <>
            <p {...stylex.props(type.small, styles.line)}>
              {nothing
                ? `Nothing new to import: « ${d.name} » already holds everything these pages recorded.`
                : `${d.creates ? `A new run « ${d.name} » (${plural(d.tests, "test")}): ` : `Into « ${d.name} »: `}${news}`}
            </p>
            {d.stepsChanged.length > 0 && (
              <Banner tone="warning" compact>
                {d.stepsChanged.length === 1
                  ? "1 test has another number of steps here than in the pages"
                  : `${d.stepsChanged.length} tests have another number of steps here than in the pages`}
                : their OK / NOK marks are not imported, their result and comments are (
                {d.stepsChanged.map((c) => `${c.summary} — ${c.here} here, ${c.pages} there`).join("; ")}).
              </Banner>
            )}
            {d.conflicts.length > 0 && (
              <Banner tone="warning" compact>
                {d.conflicts.length === 1
                  ? "1 test has a result here and another in the pages"
                  : `${d.conflicts.length} tests have a result here and another in the pages`}
                : the newer one wins, the older is kept in its history (
                {d.conflicts.map((c) => `${c.summary} — ${c.kept === "pages" ? "the pages'" : "this one"}`).join("; ")}
                ).
              </Banner>
            )}
          </>
        ) : (
          <p {...stylex.props(type.small, styles.muted)}>
            The page saves its results in its folder (or in a run.json when it had no local server).
          </p>
        )}
      </div>
    </Modal>
  );
}
