import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandInput } from "../../../core/commands/index.ts";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { execute, useRead } from "../../lib/data/query.ts";
import { message, plural } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s5 },
  pair: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: space.s4 },
  preview: { margin: 0, color: color.textMuted },
});

type From = "folder" | "review" | "labels" | "tests";
const REVIEWS = [
  { value: "validated", label: "Validated" },
  { value: "draft", label: "Draft" },
  { value: "to-fix", label: "To fix" },
] as const;

const words = (s: string) =>
  s
    .split(/[\s,;]+/)
    .map((w) => w.trim())
    .filter(Boolean);

// ponytail: a new run — its name and what it is run against, then which tests: a folder, a review state, labels or ids;
// the dry run says which tests it would freeze before anything is written
export function NewRun({ onClose, onMade }: { onClose: () => void; onMade: (slug: string) => void }) {
  const app = useApp();
  const client = useQueryClient();
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [environment, setEnvironment] = useState("");
  const [from, setFrom] = useState<From>("folder");
  const [folder, setFolder] = useState("/");
  const [review, setReview] = useState<(typeof REVIEWS)[number]["value"]>("validated");
  const [labels, setLabels] = useState("");
  const [ids, setIds] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick: Omit<CommandInput<"runs.create">, "name"> = from === "folder"
    ? { folder }
    : from === "review"
      ? { review: [review] }
      : from === "labels"
        ? { labels: words(labels) }
        : { tests: words(ids) };
  const empty = (from === "labels" && !words(labels).length) || (from === "tests" && !words(ids).length);
  const plan = useRead("runs.create", { name: name || "run", ...pick, dryRun: true }, { enabled: !empty });
  const count = empty ? 0 : (plan.data?.tests.length ?? 0);
  const folders = ["/", ...(app.info?.project.folders ?? [])];

  const make = async () => {
    setBusy(true);
    setError(null);
    try {
      const out = await execute(
        client,
        "runs.create",
        { name, ...(version ? { version } : {}), ...(environment ? { environment } : {}), ...pick },
        { invalidates: [["runs.list"]] },
      );
      if (out.slug) onMade(out.slug);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const why = !name.trim() ? "Name the run first" : !count ? "No test to run" : false;
  return (
    <Modal
      title="New run"
      subtitle="A frozen copy of the tests, as they are now: a tester plays them one by one, OK or NOK on each step."
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
        <div {...stylex.props(styles.pair)}>
          <Text label="Version under test" value={version} onChange={setVersion} placeholder="SOSIE 2.4.0-rc2" />
          <Text label="Where" value={environment} onChange={setEnvironment} placeholder="Simulator room B" />
        </div>
        <Segmented
          label="Tests from"
          value={from}
          onChange={setFrom}
          options={[
            { value: "folder", label: "A folder" },
            { value: "review", label: "A review state" },
            { value: "labels", label: "Labels" },
            { value: "tests", label: "Test keys" },
          ]}
        />
        {from === "folder" && (
          <Select
            label="Folder"
            showLabel
            value={folder}
            onChange={setFolder}
            options={folders.map((f) => ({ value: f, label: f === "/" ? "Every test" : f }))}
          />
        )}
        {from === "review" && (
          <Select label="Review state" showLabel value={review} onChange={setReview} options={[...REVIEWS]} />
        )}
        {from === "labels" && (
          <Text label="Labels" hint="Separated by spaces or commas" value={labels} onChange={setLabels} />
        )}
        {from === "tests" && (
          <Text
            label="Test keys or ids"
            hint="Separated by spaces or commas, in the order to run them"
            value={ids}
            onChange={setIds}
            placeholder="LFRPS12-1420 LFRPS12-1398"
          />
        )}
        {plan.error && !empty ? (
          <Banner tone="warning" compact>
            {plan.error.message}
          </Banner>
        ) : (
          <p {...stylex.props(type.small, styles.preview)}>
            {count
              ? `${plural(count, "test")}: ${plan.data?.tests
                  .slice(0, 4)
                  .map((t) => t.key ?? t.summary)
                  .join(", ")}${count > 4 ? "…" : ""}`
              : "No test yet."}
          </p>
        )}
      </div>
    </Modal>
  );
}
