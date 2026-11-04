import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandName } from "../../../core/commands/index.ts";
import { cliLine } from "../../lib/cli.ts";
import type { CommandInfo, JsonSchema } from "../../lib/data/client.ts";
import { execute } from "../../lib/data/query.ts";
import { message } from "../../lib/format.ts";
import { toast } from "../../lib/toast.ts";
import { PushDialog } from "../../screens/tests/PushDialog.tsx";
import { border, color, fontFamily, fontSize, lineHeight, radius, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Modal } from "../ui/Modal.tsx";
import { Select } from "../ui/Select.tsx";
import { Text } from "../ui/Text.tsx";

export { hasInput } from "./paletteEntries.tsx";

const styles = stylex.create({
  fields: { display: "flex", flexDirection: "column", gap: space.s4 },
  mono: { fontFamily: fontFamily.mono },
  result: {
    margin: 0,
    marginTop: space.s4,
    padding: space.s4,
    maxHeight: "40vh",
    overflow: "auto",
    borderWidth: border.width,
    borderStyle: "solid",
    borderColor: color.border,
    borderRadius: radius.r2,
    backgroundColor: color.surfaceSunken,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    whiteSpace: "pre-wrap",
  },
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

// ponytail: a command's form, made from its input schema — one field per input with its describe() as the hint, the
// command line that does the same, and the plain result (or the job it started)
export function CommandForm({
  command,
  onClose,
  onJob,
}: {
  command: CommandInfo;
  onClose: () => void;
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
        toast({ kind: "info", title: `${command.name} started`, detail: "Follow it in Jobs." });
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
  return (
    <Modal
      title={command.name}
      subtitle={command.summary}
      icon="terminal"
      onClose={onClose}
      onSubmit={() => void submit()}
      error={error}
      footNote={
        <>
          Same as <span {...stylex.props(styles.mono)}>{cliLine(command.name, preview)}</span>
        </>
      }
      actions={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button variant="primary" type="submit" label={busy ? "Running…" : "Run"} disabled={busy} />
        </>
      }
    >
      <div {...stylex.props(styles.fields)}>
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
        <pre data-testid="command-result" {...stylex.props(styles.result)}>
          {result}
        </pre>
      )}
    </Modal>
  );
}
