import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useContext, useState } from "react";
import type { CommandName } from "../../../core/commands/index.ts";
import { AppContext } from "../../lib/app.ts";
import { cliLine } from "../../lib/cli.ts";
import type { CommandInfo, JsonSchema } from "../../lib/data/client.ts";
import { execute, useRead } from "../../lib/data/query.ts";
import { message } from "../../lib/format.ts";
import { jobToast } from "../../lib/toast.ts";
import { PushDialog } from "../../screens/tests/PushDialog.tsx";
import { space } from "../../styles/tokens.stylex.ts";
import { Banner } from "../ui/Banner.tsx";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Raw } from "../ui/Raw.tsx";
import { Select } from "../ui/Select.tsx";
import { Text } from "../ui/Text.tsx";
import { type } from "../ui/type.ts";
import { firstSentence } from "./paletteEntries.tsx";

export { hasInput } from "./paletteEntries.tsx";

const styles = stylex.create({
  fields: { display: "flex", flexDirection: "column", gap: space.s4 },
  result: { marginTop: space.s4 },
});

// ponytail: Jira writes from the palette never go blind — a push opens the plan dialog
export const plannedFirst = (name: string, input: Record<string, unknown>): "push" | null =>
  input.dryRun !== true && name === "xray.push" ? "push" : null;

type Loss = { verb: string; what: string; danger?: boolean; when?: (input: Record<string, unknown>) => boolean };

// ponytail: what a command run from the palette loses — asked first with its verb (red when something is lost for
// good); a command with a dry run shows its plan before, and this verb then does it
export const LOSES: Record<string, Loss> = {
  "project.delete": {
    verb: "Delete the project",
    what: "The project folder is deleted from this PC: its documents, tests and index. Nothing is deleted in Jira.",
  },
  "tests.remove": {
    verb: "Delete the test",
    what: "The test folder is deleted, with any change not pushed to Jira. Jira is not touched.",
  },
  "docs.remove": {
    verb: "Remove the document",
    what: "The document, its figures and its passages in the search index are removed; the tests that cite it report it missing.",
  },
  "xray.pull": {
    verb: "Replace with Jira's version",
    what: "A local copy with changes not pushed is replaced by Jira's version: those changes are lost.",
    when: (i) => i.overwrite === true,
  },
  "xray.disconnect": {
    verb: "Work locally only",
    what: "Nothing reads or writes Jira for this project until it is connected again. The local tests stay as they are.",
    danger: false,
  },
  "contexts.remove": {
    verb: "Delete the context",
    what: "The context's folder is deleted — a shared context for every project; the tests that named it stop taking it.",
  },
  "columns.remove": {
    verb: "Remove the column",
    what: "The column is no longer a step column; the text the tests hold in it stays in their files.",
  },
  "models.remove": { verb: "Remove the model", what: "A downloaded model's files are deleted from this PC." },
  "rag.dropSpace": {
    verb: "Delete the vectors",
    what: "This vector space is deleted from the index; it takes a new indexing to build it again.",
  },
  "jobs.clear": { verb: "Clear the jobs", what: "The finished jobs are forgotten and their logs deleted." },
  "runs.remove": {
    verb: "Delete the run",
    what: "The run's folder is deleted with every result, comment, question and screenshot of it. The tests are not touched.",
  },
  "project.forget": {
    verb: "Forget the project",
    what: "The project leaves the list of known projects; its folder stays on this PC.",
    danger: false,
  },
  "claude.revert": {
    verb: "Revert",
    what: "The tests the Claude run changed go back to their version from before it; with force, later edits are dropped too.",
  },
};

export const lossOf = (name: string, input: Record<string, unknown>): Loss | null => {
  const l = LOSES[name];
  return l && (!l.when || l.when(input)) ? l : null;
};

// ponytail: the Claude runs the palette's form hands to the dock, where their answer shows and Revert lives
const IN_DOCK: Record<string, (i: Record<string, unknown>) => { label: string; testId: string }> = {
  "review.fix": (i) => ({
    label: typeof i.note === "string" && i.note ? i.note : "Fix the test",
    testId: typeof i.id === "string" ? i.id : "",
  }),
  "actions.run": () => ({ label: "Run the action", testId: "" }),
};

const kindOf = (s: JsonSchema): string => {
  if (s.enum) return "enum";
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== "null") : s.type;
  if (t === "array" && (!s.items || s.items.type === "string")) return "list";
  if (t === "string" || t === "number" || t === "integer" || t === "boolean") return t;
  if (s.anyOf?.length) return kindOf(s.anyOf.find((a) => a.type !== "null") ?? {});
  return "json";
};

export function formValue(schema: JsonSchema, raw: Record<string, string | boolean>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, s] of Object.entries(schema.properties ?? {})) {
    const v = raw[k];
    if (v === undefined || v === "") continue;
    const kind = kindOf(s);
    if (kind === "boolean") out[k] = v === true;
    else if (kind === "number" || kind === "integer") out[k] = Number(v);
    else if (kind === "list")
      out[k] = String(v)
        .split(/[,\n]/)
        .map((x) => x.trim())
        .filter(Boolean);
    else if (kind === "json") out[k] = JSON.parse(String(v));
    else out[k] = v;
  }
  return out;
}

const PLACEHOLDER: Record<string, string | undefined> = { list: "comma-separated", json: "JSON", number: "a number" };

// ponytail: a field whose values the project knows is a choice of them, not a box to type into (a document id)
const isDocId = (s: JsonSchema) => /^Document id\b/.test(s.description ?? "");

// ponytail: a command's form, made from its input schema — titled by what it does, with its name beside; one field per
// input with its describe() as the hint (a document id is a choice of the project's documents), the command line that
// does the same, and the plain result (or the job it started); Ctrl+Enter runs it, « Back to results » goes back to
// the palette it came from. It never acts blind: a dry run shows its plan first, a loss is confirmed, a Claude run
// goes to the dock
export function CommandForm({
  command,
  onClose,
  onBack,
}: {
  command: CommandInfo;
  onClose: () => void;
  onBack?: () => void;
}) {
  const client = useQueryClient();
  const app = useContext(AppContext);
  const props = Object.entries(command.input?.properties ?? {});
  const required = new Set(command.input?.required ?? []);
  const planned = props.some(([k]) => k === "dryRun") && command.mutates;
  const [raw, setRaw] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [plan, setPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushId, setPushId] = useState<string | null>(null);
  const [asking, setAsking] = useState<Record<string, unknown> | null>(() =>
    props.length ? null : lossOf(command.name, {}) ? {} : null,
  );
  const set = (k: string, v: string | boolean) => {
    setRaw((r) => ({ ...r, [k]: v }));
    setPlan(null);
  };
  const wantsDocs = props.some(([, s]) => isDocId(s));
  const docs = useRead("docs.list", {}, { enabled: wantsDocs }).data ?? [];
  let preview: Record<string, unknown> = {};
  try {
    preview = formValue(command.input, raw);
  } catch {}

  const title = firstSentence(command.summary) || command.name;
  const run = (input: Record<string, unknown>) =>
    execute(client, command.name as CommandName, input as never, {
      invalidates: command.mutates && input.dryRun !== true ? "project" : "none",
    });
  const shown = (r: unknown) => {
    const jobId = command.job ? (r as { jobId?: string } | null)?.jobId : undefined;
    if (jobId && app) {
      jobToast(`${title} — started`, jobId, app.navigate);
      onClose();
      return;
    }
    if (jobId) return onClose();
    setResult(JSON.stringify(r, null, 2));
  };
  const send = async (input: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const dry = planned && input.dryRun !== true && plan === null;
      const r = await run(dry ? { ...input, dryRun: true } : input);
      if (dry) setPlan(JSON.stringify(r, null, 2));
      else shown(r);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    let input: Record<string, unknown>;
    try {
      input = formValue(command.input, raw);
    } catch (e) {
      setError(message(e));
      return;
    }
    if (plannedFirst(command.name, input) === "push") {
      if (typeof input.id !== "string" || !input.id) {
        setError("Give the id of the test to push.");
        return;
      }
      setPushId(input.id);
      return;
    }
    const dock = IN_DOCK[command.name];
    if (dock && app) {
      app.runInDock({ name: command.name, input, ...dock(input) });
      onClose();
      return;
    }
    if (!planned && lossOf(command.name, input)) {
      setAsking(input);
      return;
    }
    await send(input);
  };
  const loss = lossOf(command.name, asking ?? {});
  if (asking && loss)
    return (
      <Modal
        title={`${title}?`}
        size="sm"
        subtitle={<span {...stylex.props(type.mono)}>{cliLine(command.name, asking)}</span>}
        confirm={{
          verb: loss.verb,
          danger: loss.danger !== false,
          icon: loss.danger === false ? null : undefined,
          onConfirm: async () => {
            const r = await run(asking);
            setAsking(null);
            shown(r);
          },
        }}
        onClose={() => (props.length ? setAsking(null) : onClose())}
      >
        {loss.what}
      </Modal>
    );
  if (pushId)
    return (
      <PushDialog
        testId={pushId}
        summary=""
        onDone={() => {
          setPushId(null);
          onClose();
        }}
        onClose={() => setPushId(null)}
      />
    );
  const risk = lossOf(command.name, preview);
  const planFirst = planned && preview.dryRun !== true;
  const rest = command.summary.slice(title.length).replace(/^[.:]?\s*/, "");
  return (
    <Modal
      title={title}
      subtitle={
        <>
          <span {...stylex.props(type.mono)}>{command.name}</span>
          {rest && ` · ${rest}`}
        </>
      }
      icon="terminal"
      onClose={onClose}
      onSubmit={() => void submit()}
      error={error}
      footNote={
        <>
          <Icon name="terminal" size="sm" />
          Same as <span {...stylex.props(type.mono)}>{cliLine(command.name, preview)}</span>
        </>
      }
      actions={
        <>
          {onBack ? (
            <Button variant="quiet" icon="arrow-left" label="Back to results" onClick={onBack} />
          ) : (
            <Button label="Cancel" onClick={onClose} />
          )}
          <Button
            variant={plan !== null && risk && risk.danger !== false ? "danger" : "primary"}
            type="submit"
            label={busy ? "Running…" : plan !== null ? (risk?.verb ?? "Run") : planFirst ? "Show the plan" : "Run"}
            shortcut="Ctrl+Enter"
            disabled={busy}
          />
        </>
      }
    >
      <div
        {...stylex.props(styles.fields)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
          e.preventDefault();
          if (!busy) void submit();
        }}
      >
        {props.map(([k, s]) => {
          const kind = kindOf(s);
          const label = `${k}${required.has(k) ? "" : " (optional)"}`;
          if (kind === "boolean")
            return (
              <Checkbox
                key={k}
                label={label}
                hint={s.description}
                checked={raw[k] === true}
                onChange={(on) => set(k, on)}
              />
            );
          if (kind === "string" && isDocId(s) && docs.length)
            return (
              <Select
                key={k}
                label={label}
                showLabel
                block
                placeholder="Pick a document"
                value={raw[k] ? String(raw[k]) : null}
                options={docs.map((d) => ({ value: d.id, label: `${d.id} · ${d.title || d.id}` }))}
                onChange={(v) => set(k, v)}
              />
            );
          if (kind === "enum")
            return (
              <Select
                key={k}
                label={label}
                showLabel
                block
                placeholder="—"
                value={raw[k] ? String(raw[k]) : null}
                options={(s.enum ?? []).map((o) => ({ value: String(o), label: String(o) }))}
                onChange={(v) => set(k, v)}
              />
            );
          return (
            <Text
              key={k}
              label={label}
              hint={s.description}
              value={String(raw[k] ?? "")}
              onChange={(v) => set(k, v)}
              multiline={kind === "json"}
              placeholder={PLACEHOLDER[kind]}
              spellCheck={false}
            />
          );
        })}
      </div>
      {plan !== null && (
        <div data-testid="command-plan" {...stylex.props(styles.result)}>
          <Raw text={plan} maxLines={16} label="What it would do — nothing changed yet" />
          {risk && (
            <Banner tone="warning" compact>
              {risk.what}
            </Banner>
          )}
        </div>
      )}
      {result !== null && (
        <div data-testid="command-result" {...stylex.props(styles.result)}>
          <Raw text={result} maxLines={16} label="Result" />
        </div>
      )}
    </Modal>
  );
}
