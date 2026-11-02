import { useState } from "react";
import type { Effort, Preset } from "../../../core/types.ts";
import { Button, Chip } from "../../components/ui/index.ts";
import { useApp } from "../../lib/app.ts";
import { saveProject } from "./ProjectSection.tsx";

const MODELS = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "haiku", label: "Haiku" },
];
const EFFORTS: Effort[] = ["low", "medium", "high", "xhigh", "max"];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function ClaudeSection() {
  const app = useApp();
  const c = app.info?.project.claude;
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [ctx, setCtx] = useState("");
  if (!c) return null;
  const save = (claude: Record<string, unknown>, what: string) => void saveProject({ claude }, app.refreshInfo, what);
  const presets: Preset[] = c.presets ?? [];
  return (
    <section className="card sect" id="settings-claude" aria-labelledby="s-claude">
      <h2 id="s-claude" className="h sect-title">
        Claude
      </h2>
      <div className="formgrid">
        <div className="formfield">
          <label className="label" htmlFor="set-model">
            Default model
          </label>
          <select
            id="set-model"
            className="field"
            value={c.model}
            onChange={(e) => save({ model: e.target.value }, "Model")}
          >
            {(MODELS.some((m) => m.value === c.model) ? MODELS : [{ value: c.model, label: c.model }, ...MODELS]).map(
              (m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ),
            )}
          </select>
        </div>
        <div className="formfield">
          <label className="label" htmlFor="set-effort">
            Default effort
          </label>
          <select
            id="set-effort"
            className="field"
            value={c.effort}
            onChange={(e) => save({ effort: e.target.value }, "Effort")}
          >
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {cap(e)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="formfield">
        <span className="label">Quick requests</span>
        <div className="chips">
          {presets.map((p) => (
            <span key={p.label} title={p.prompt}>
              <Chip
                onRemove={() => save({ presets: presets.filter((x) => x.label !== p.label) }, "Quick requests")}
                removeLabel={`Remove quick request ${p.label}`}
              >
                {p.label}
              </Chip>
            </span>
          ))}
          {!adding && (
            <Button tone="quiet" size="sm" icon="plus" onClick={() => setAdding(true)}>
              Add
            </Button>
          )}
        </div>
        {adding && (
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
                  save({ presets: [...presets, { label: label.trim(), prompt: prompt.trim() }] }, "Quick requests");
                  setLabel("");
                  setPrompt("");
                  setAdding(false);
                }}
              >
                Add the quick request
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="formfield">
        <span className="label">Contexts — reference notes attached to every request</span>
        <div className="ctxlist">
          {c.contexts.map((id) => (
            <div key={id} className="ctxrow">
              <span className="mono">{id}</span>
              <span className="muted">contexts/{id}/</span>
              <span className="spacer" />
              <Button
                tone="quiet"
                size="sm"
                onClick={() => save({ contexts: c.contexts.filter((x) => x !== id) }, "Contexts")}
              >
                Detach
              </Button>
            </div>
          ))}
          {!c.contexts.length && <span className="muted">No context attached yet.</span>}
        </div>
        <div className="ctxadd">
          <input
            className="field mono"
            aria-label="Context to attach (folder name under contexts/)"
            placeholder="house-style"
            value={ctx}
            onChange={(e) => setCtx(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!ctx.trim() || c.contexts.includes(ctx.trim())}
            onClick={() => {
              save({ contexts: [...c.contexts, ctx.trim()] }, "Contexts");
              setCtx("");
            }}
          >
            Attach
          </Button>
        </div>
        <span className="muted">A context is a folder under contexts/ in the project: notes.md and its files.</span>
      </div>
    </section>
  );
}
