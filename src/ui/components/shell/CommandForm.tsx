import { useState } from "react";
import type { PlanOp } from "../../../core/types.ts";
import { type CommandInfo, call, type JsonSchema } from "../../api.ts";
import { message } from "../../lib/format.ts";
import { toast } from "../../lib/toast.ts";
import { PushDialog } from "../../screens/tests/PushDialog.tsx";
import { Button, Field, Modal } from "../ui/index.ts";

// ponytail: Jira writes from the palette never go blind — a push opens the plan dialog, a direct CSV import
// is planned with dryRun first and only sent from its Confirm
export const plannedFirst = (name: string, input: Record<string, unknown>): "push" | "import" | null =>
  input.dryRun === true
    ? null
    : name === "xray.push"
      ? "push"
      : name === "xray.importCsv" && input.mode === "direct" && !input.jobId
        ? "import"
        : null;

const kindOf = (s: JsonSchema): string => {
  if (s.enum) return "enum";
  const t = Array.isArray(s.type) ? s.type.find((x) => x !== "null") : s.type;
  if (t === "array" && (!s.items || s.items.type === "string")) return "list";
  if (t === "string" || t === "number" || t === "integer" || t === "boolean") return t;
  if (s.anyOf?.length) return kindOf(s.anyOf.find((a) => a.type !== "null") ?? {});
  return "json";
};

export const hasInput = (c: CommandInfo) => Object.keys(c.input?.properties ?? {}).length > 0;

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

export function CommandForm({
  command,
  onClose,
  onJob,
}: {
  command: CommandInfo;
  onClose: () => void;
  onJob?: (jobId: string) => void;
}) {
  const props = Object.entries(command.input?.properties ?? {});
  const required = new Set(command.input?.required ?? []);
  const [raw, setRaw] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pushId, setPushId] = useState<string | null>(null);
  const [importPlan, setImportPlan] = useState<{ input: Record<string, unknown>; plan: PlanOp[] } | null>(null);
  const send = async (input: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call<unknown>(command.name, input);
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
    const planned = plannedFirst(command.name, input);
    if (planned === "push") {
      if (typeof input.id !== "string" || !input.id) {
        setError("Give the id of the test to push.");
        return;
      }
      setPushId(input.id);
      return;
    }
    if (planned === "import") {
      setBusy(true);
      setError(null);
      try {
        const r = await call<{ plan?: PlanOp[] }>(command.name, { ...input, dryRun: true });
        setImportPlan({ input, plan: r?.plan ?? [] });
      } catch (e) {
        setError(message(e));
      } finally {
        setBusy(false);
      }
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
  if (importPlan)
    return (
      <Modal
        label="Import plan"
        title="Import into Xray"
        subtitle="Nothing has been sent yet."
        width={560}
        onClose={() => setImportPlan(null)}
        foot={
          <>
            <span className="spacer" />
            <Button tone="quiet" onClick={() => setImportPlan(null)}>
              Cancel
            </Button>
            <Button
              tone="primary"
              onClick={() => {
                const input = importPlan.input;
                setImportPlan(null);
                void send(input);
              }}
            >
              Import into Xray
            </Button>
          </>
        }
      >
        <ol className="imp-plan">
          {importPlan.plan.map((p, i) => (
            <li key={i}>{p.label}</li>
          ))}
        </ol>
      </Modal>
    );
  return (
    <Modal
      label={command.name}
      title={<span className="mono">{command.name}</span>}
      subtitle={command.summary}
      width={560}
      onClose={onClose}
      foot={
        <>
          <span className="muted foot-hint">
            Same as <span className="mono">testimus {command.name.replace(".", " ")}</span>
          </span>
          <div className="spacer" />
          <Button tone="quiet" onClick={onClose}>
            Close
          </Button>
          <Button tone="primary" disabled={busy} onClick={() => void submit()}>
            {busy ? "Running…" : "Run"}
          </Button>
        </>
      }
    >
      <form
        className="cmdform"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {props.map(([k, s]) => {
          const kind = kindOf(s);
          const id = `cmd-${k}`;
          const label = `${k}${required.has(k) ? "" : " (optional)"}`;
          return (
            <Field key={k} label={label} htmlFor={id} hint={s.description}>
              {kind === "boolean" ? (
                <input
                  id={id}
                  type="checkbox"
                  checked={raw[k] === true}
                  onChange={(e) => setRaw({ ...raw, [k]: e.target.checked })}
                />
              ) : kind === "enum" ? (
                <select
                  id={id}
                  className="field"
                  value={String(raw[k] ?? "")}
                  onChange={(e) => setRaw({ ...raw, [k]: e.target.value })}
                >
                  <option value="">—</option>
                  {(s.enum ?? []).map((o) => (
                    <option key={String(o)} value={String(o)}>
                      {String(o)}
                    </option>
                  ))}
                </select>
              ) : kind === "json" ? (
                <textarea
                  id={id}
                  className="field mono"
                  rows={3}
                  placeholder="JSON"
                  value={String(raw[k] ?? "")}
                  onChange={(e) => setRaw({ ...raw, [k]: e.target.value })}
                />
              ) : (
                <input
                  id={id}
                  className="field"
                  type={kind === "number" || kind === "integer" ? "number" : "text"}
                  placeholder={kind === "list" ? "comma-separated" : undefined}
                  value={String(raw[k] ?? "")}
                  onChange={(e) => setRaw({ ...raw, [k]: e.target.value })}
                />
              )}
            </Field>
          );
        })}
        <button type="submit" hidden />
      </form>
      {error && (
        <div className="find f-err" role="alert">
          <p>{error}</p>
        </div>
      )}
      {result !== null && <pre className="cmd-result mono">{result}</pre>}
    </Modal>
  );
}
