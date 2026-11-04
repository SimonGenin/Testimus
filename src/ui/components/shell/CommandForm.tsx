import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandName } from "../../../core/commands/index.ts";
import { cliLine } from "../../lib/cli.ts";
import type { CommandInfo, JsonSchema } from "../../lib/data/client.ts";
import { execute, useRead } from "../../lib/data/query.ts";
import { message } from "../../lib/format.ts";
import { toast } from "../../lib/toast.ts";
import { PushDialog } from "../../screens/tests/PushDialog.tsx";
import { fontFamily, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Raw } from "../ui/Raw.tsx";
import { Select } from "../ui/Select.tsx";
import { Text } from "../ui/Text.tsx";

import { firstSentence } from "./paletteEntries.tsx";

export { hasInput } from "./paletteEntries.tsx";

const styles = stylex.create({
  fields: { display: "flex", flexDirection: "column", gap: space.s4 },
  mono: { fontFamily: fontFamily.mono },
  result: { marginTop: space.s4 },
});

// ponytail: Jira writes from the palette never go blind — a push opens the plan dialog
export const plannedFirst = (name: string, input: Record<string, unknown>): "push" | null =>
  input.dryRun !== true && name === "xray.push" ? "push" : null;

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
// the palette it came from
export function CommandForm({
  command,
  onClose,
  onBack,
  onJob,
}: {
  command: CommandInfo;
  onClose: () => void;
  onBack?: () => void;
  onJob?: (jobId: string) => void;
}) {
  const client = useQueryClient();
  const props = Object.entries(command.input?.properties ?? {});
  const required = new Set(command.input?.required ?? []);
  const [raw, setRaw] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushId, setPushId] = useState<string | null>(null);
  const set = (k: string, v: string | boolean) => setRaw((r) => ({ ...r, [k]: v }));
  const wantsDocs = props.some(([, s]) => isDocId(s));
  const docs = useRead("docs.list", {}, { enabled: wantsDocs }).data ?? [];
  let preview: Record<string, unknown> = {};
  try {
    preview = formValue(command.input, raw);
  } catch {}

  const send = async (input: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await execute(client, command.name as CommandName, input as never, {
        invalidates: command.mutates ? "project" : "none",
      });
      const jobId = command.job ? (r as { jobId?: string } | null)?.jobId : undefined;
      if (jobId) {
        toast({ tone: "neutral", title: `${command.name} started`, detail: "Follow it in Jobs." });
        onJob?.(jobId);
        onClose();
        return;
      }
      setResult(JSON.stringify(r, null, 2));
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
    await send(input);
  };
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
  const title = firstSentence(command.summary) || command.name;
  const rest = command.summary.slice(title.length).replace(/^[.:]?\s*/, "");
  return (
    <Modal
      title={title}
      subtitle={
        <>
          <span {...stylex.props(styles.mono)}>{command.name}</span>
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
          Same as <span {...stylex.props(styles.mono)}>{cliLine(command.name, preview)}</span>
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
            variant="primary"
            type="submit"
            label={busy ? "Running…" : "Run"}
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
      {result !== null && (
        <div data-testid="command-result" {...stylex.props(styles.result)}>
          <Raw text={result} maxLines={16} label="Result" />
        </div>
      )}
    </Modal>
  );
}
