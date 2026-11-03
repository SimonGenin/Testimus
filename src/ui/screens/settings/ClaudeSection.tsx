import { useCallback, useEffect, useRef, useState } from "react";
import type { Effort, Preset, Settings } from "../../../core/types.ts";
import { call } from "../../api.ts";
import { type ClaudeStatus, ConnectClaude } from "../../components/claude/ConnectClaude.tsx";
import { CONTEXTS_EVENT, type ContextSummary, ContextsDialog } from "../../components/claude/ContextsDialog.tsx";
import { cap, EFFORTS, ModelPicker } from "../../components/claude/ModelPicker.tsx";
import { Button, IconButton } from "../../components/legacy/index.ts";
import { useApp } from "../../lib/app.ts";
import { desktop, examplePath, onWindows, pickFiles } from "../../lib/desktop.ts";
import { useDraft } from "../../lib/drafts.ts";
import { cx, message } from "../../lib/format.ts";
import { errorToast } from "../../lib/toast.ts";
import { AgentsField } from "./AgentsField.tsx";
import { saveProject } from "./ProjectSection.tsx";

const saveSettings = (patch: Record<string, unknown>) =>
  call<Settings>("system.saveSettings", patch).catch((e) => {
    errorToast(e, "Could not save the settings");
    return null;
  });

const same = (a: Preset[], b: Preset[]) => JSON.stringify(a) === JSON.stringify(b);

export function exeLine(s: ClaudeStatus): string {
  return s.installed
    ? `✓ ${s.version ?? "Claude Code"} · found`
    : `✕ ${(s.detail || "claude did not answer").split("\n")[0].slice(0, 160)} · not found · Claude is optional`;
}

type SettingsProps = { s: Settings | null; setS: (s: Settings) => void };

function ClaudeProgram({ s, setS }: SettingsProps) {
  const app = useApp();
  const [exe, setExe] = useState("");
  const [st, setSt] = useState<ClaudeStatus | "checking" | null>(null);
  const loaded = useRef(false);
  useEffect(() => {
    if (!s || loaded.current) return;
    loaded.current = true;
    setExe(s.claude?.exe ?? "");
  }, [s]);
  useEffect(() => {
    call<ClaudeStatus>("claude.status", {})
      .then((r) => setSt((cur) => cur ?? r))
      .catch(() => {});
  }, []);

  const commit = async (value: string) => {
    if (!s || value === s.claude.exe) return true;
    const r = await saveSettings({ claudeExe: value });
    if (r) setS(r);
    return !!r;
  };
  // ponytail: leaving Settings unmounts it without a blur — a typed path is saved from the cleanup (Xray Editor)
  const onUnmount = useRef(() => {});
  onUnmount.current = () => void commit(exe);
  useEffect(() => () => onUnmount.current(), []);
  const check = async (value = exe) => {
    setSt("checking");
    if (!(await commit(value))) {
      setSt(null);
      return;
    }
    const r = await call<ClaudeStatus>("claude.status", { refresh: true }).catch(
      (e): ClaudeStatus => ({ installed: false, signedIn: false, detail: message(e) }),
    );
    setSt(r);
  };

  return (
    <div className="formfield">
      <label className="label" htmlFor="settings-claude-exe">
        Claude program
      </label>
      <div className="pickrow">
        <input
          id="settings-claude-exe"
          className="field mono"
          placeholder={`Found on PATH — or ${examplePath("C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd", "/Users/you/.local/bin/claude")}`}
          spellCheck={false}
          value={exe}
          onChange={(e) => setExe(e.target.value)}
          onBlur={() => void commit(exe)}
          onKeyDown={(e) => e.key === "Enter" && void check()}
        />
        {desktop() && (
          <Button
            aria-label="Browse for the Claude program"
            disabled={!s}
            onClick={() =>
              void pickFiles(
                "Choose the Claude program",
                onWindows() ? [{ name: "Programs", extensions: ["exe", "cmd"] }] : [],
                false,
              ).then(([picked]) => {
                if (!picked) return;
                setExe(picked);
                void check(picked);
              })
            }
          >
            Browse…
          </Button>
        )}
        <Button disabled={st === "checking"} onClick={() => void check()}>
          {st === "checking" ? "Checking…" : "Check"}
        </Button>
      </div>
      {st && (
        <span
          className={cx("exe-status", st !== "checking" && (st.installed ? "exe-ok" : "exe-bad"))}
          role="status"
          title={st === "checking" ? undefined : st.detail}
        >
          {st === "checking" ? "Running claude --version…" : exeLine(st)}
        </span>
      )}
      {st && st !== "checking" && !st.installed && (
        <div className="card exe-connect">
          <ConnectClaude
            status={st}
            checking={false}
            onCheck={() => void check()}
            onDoctor={() => app.navigate("doctor")}
          />
        </div>
      )}
    </div>
  );
}

function QuickAsks({ presets, save }: { presets: Preset[]; save: (p: Preset[]) => void }) {
  const [drafts, setDrafts] = useState(presets);
  const [adding, setAdding] = useDraft("settings.quickAsk.adding", false);
  const [label, setLabel] = useDraft("settings.quickAsk.label", "");
  const [prompt, setPrompt] = useDraft("settings.quickAsk.prompt", "");
  useEffect(() => setDrafts(presets), [presets]);
  const edit = (i: number, p: Partial<Preset>) => setDrafts((d) => d.map((x, k) => (k === i ? { ...x, ...p } : x)));
  // ponytail: leaving Settings unmounts it without a blur — an edited quick ask is saved from the cleanup, once
  const sent = useRef(presets);
  const commit = () => {
    const next = drafts.map((p) => ({ label: p.label.trim(), prompt: p.prompt.trim() }));
    if (same(next, presets) || same(next, sent.current) || !next.every((p) => p.label && p.prompt)) return;
    sent.current = next;
    save(next);
  };
  const onUnmount = useRef(commit);
  onUnmount.current = commit;
  useEffect(() => () => onUnmount.current(), []);
  return (
    <div className="formfield">
      <div className="quickasks">
        {drafts.map((p, i) => (
          <div key={i} className="quickask">
            <div className="quickask-head">
              <input
                className="field"
                aria-label={`Quick ask ${i + 1} label`}
                placeholder="Label shown as a chip"
                value={p.label}
                onChange={(e) => edit(i, { label: e.target.value })}
                onBlur={commit}
              />
              <IconButton
                icon="close"
                label={`Remove quick ask ${i + 1}`}
                onClick={() => save(presets.filter((_, k) => k !== i))}
              />
            </div>
            <textarea
              className="field"
              rows={2}
              aria-label={`Quick ask ${i + 1} prompt`}
              placeholder="What Claude is asked to do"
              value={p.prompt}
              onChange={(e) => edit(i, { prompt: e.target.value })}
              onBlur={commit}
            />
          </div>
        ))}
        {!drafts.length && <span className="muted">No quick ask yet.</span>}
      </div>
      {adding ? (
        <div className="preset-form">
          <input
            className="field"
            aria-label="Quick request name"
            placeholder="Name, e.g. Check this step"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <textarea
            className="field"
            rows={2}
            aria-label="What Claude is asked"
            placeholder="What Claude is asked"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="setup-actions">
            <span className="spacer" />
            <Button tone="quiet" size="sm" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              tone="primary"
              disabled={!label.trim() || !prompt.trim()}
              onClick={() => {
                save([...presets, { label: label.trim(), prompt: prompt.trim() }]);
                setLabel("");
                setPrompt("");
                setAdding(false);
              }}
            >
              Add the quick request
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button tone="quiet" size="sm" icon="plus" onClick={() => setAdding(true)}>
            Add
          </Button>
        </div>
      )}
      <span className="muted">
        Chips in the Claude dock: a click fills the request, which you can edit before sending.
      </span>
    </div>
  );
}

export function ClaudeSection() {
  const app = useApp();
  const c = app.info?.project.claude;
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    call<Settings>("system.settings", {})
      .then(setS)
      .catch(() => {});
  }, []);
  const [contexts, setContexts] = useState<ContextSummary[] | null>(null);
  const [managing, setManaging] = useState(false);
  const hasProject = !!c;
  const loadContexts = useCallback(() => {
    if (!hasProject) return;
    call<ContextSummary[]>("contexts.list", {})
      .then((l) => setContexts(l ?? []))
      .catch(() => setContexts([]));
  }, [hasProject]);
  useEffect(() => {
    loadContexts();
    window.addEventListener(CONTEXTS_EVENT, loadContexts);
    return () => window.removeEventListener(CONTEXTS_EVENT, loadContexts);
  }, [loadContexts]);

  const save = (claude: Record<string, unknown>, what: string) => void saveProject({ claude }, app.refreshInfo, what);
  return (
    <>
      <section className="card sect" id="settings-claude" aria-labelledby="s-claude">
        <h2 id="s-claude" className="h sect-title">
          Connection to Claude
        </h2>
        <ClaudeProgram s={s} setS={setS} />
        <AgentsField s={s} setS={setS} />
      </section>
      {c && (
        <>
          <section className="card sect" id="settings-claude-dock" aria-labelledby="s-claude-dock">
            <h2 id="s-claude-dock" className="h sect-title">
              Claude dock
            </h2>
            <div className="formgrid">
              <div className="formfield">
                <label className="label" htmlFor="set-model">
                  Default model
                </label>
                <div className="model-pick">
                  <ModelPicker
                    id="set-model"
                    className="field"
                    value={c.model}
                    onChange={(model) => save({ model }, "Model")}
                  />
                </div>
              </div>
              <div className="formfield">
                <label className="label" htmlFor="set-effort">
                  Default effort
                </label>
                <select
                  id="set-effort"
                  className="field"
                  value={c.effort}
                  onChange={(e) => save({ effort: e.target.value as Effort }, "Effort")}
                >
                  {EFFORTS.map((e) => (
                    <option key={e} value={e}>
                      {cap(e)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <span className="muted">Pre-selected in the Claude dock; each run can still change them.</span>
          </section>
          <section className="card sect" id="settings-claude-quickasks" aria-labelledby="s-claude-quickasks">
            <h2 id="s-claude-quickasks" className="h sect-title">
              Quick asks
            </h2>
            <QuickAsks presets={c.presets ?? []} save={(presets) => save({ presets }, "Quick asks")} />
          </section>
          <section className="card sect" id="settings-claude-contexts" aria-labelledby="s-claude-contexts">
            <h2 id="s-claude-contexts" className="h sect-title">
              Contexts
            </h2>
            <div className="formfield">
              <span className="label">Default contexts — attached to every test that has no list of its own</span>
              <fieldset className="presets plainset" aria-label="Default contexts">
                {contexts?.map((x) => {
                  const on = c.contexts.includes(x.id);
                  return (
                    <button
                      key={x.id}
                      type="button"
                      className={cx("chip chip-btn", on && "chip-on")}
                      aria-pressed={on}
                      onClick={() =>
                        save(
                          { contexts: on ? c.contexts.filter((id) => id !== x.id) : [...c.contexts, x.id] },
                          "Default contexts",
                        )
                      }
                    >
                      {x.name || x.id}
                    </button>
                  );
                })}
                {contexts && !contexts.length && <span className="muted">No context yet.</span>}
              </fieldset>
              <div>
                <Button size="sm" onClick={() => setManaging(true)}>
                  Manage contexts…
                </Button>
              </div>
              <span className="muted">
                A context is notes, copied files and outside paths Claude reads before it works (contexts/ in the
                project).
              </span>
            </div>
          </section>
        </>
      )}
      {managing && (
        <ContextsDialog
          onClose={() => {
            setManaging(false);
            loadContexts();
          }}
        />
      )}
    </>
  );
}
