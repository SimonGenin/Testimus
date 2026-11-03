import { useState } from "react";
import type { Precondition, SyncState, Test } from "../../../core/types.ts";
import {
  Button,
  Chip,
  ChipInput,
  GeneratedBadge,
  GrowArea,
  Icon,
  IconButton,
  Menu,
  type MenuItem,
  ReviewBadge,
  SyncBadge,
} from "../../components/ui/index.ts";

export type RemoteCheck = "checking" | "unchanged" | "remote-changed" | "unverified" | null;
export type ContextRef = { id: string; name: string };
export type TestContexts = { effective: string[]; own: string[] | null };

export function TestHeader({
  test,
  sync,
  edited,
  dirty,
  remote,
  saving,
  activity,
  folders,
  readOnly,
  details,
  preconditions,
  contexts,
  testContexts,
  canPush,
  jiraOff,
  pushing,
  menu,
  onDetails,
  onPush,
  onAsk,
  onRemote,
  onFolders,
  onContexts,
  onManageContexts,
  update,
}: {
  test: Test;
  sync: SyncState;
  edited?: boolean;
  dirty: boolean;
  remote: RemoteCheck;
  saving: "idle" | "saving" | "saved";
  activity?: string;
  folders: string[];
  readOnly?: boolean;
  details: boolean;
  preconditions: Precondition[] | null;
  contexts: ContextRef[];
  testContexts: TestContexts | null;
  canPush: boolean;
  jiraOff?: boolean;
  pushing?: boolean;
  menu: MenuItem[];
  onDetails: (open: boolean) => void;
  onPush: () => void;
  onAsk: () => void;
  onRemote: () => void;
  onFolders?: () => void;
  onContexts: (ids: string[] | null) => void;
  onManageContexts: () => void;
  update: (fn: (t: Test) => Test) => void;
}) {
  const [editFolder, setEditFolder] = useState(false);
  const pre = preconditions ?? [];
  const attachable = pre.filter((p) => !test.preconditions.includes(p.key));
  const eff = testContexts?.effective ?? [];
  const ctxName = (id: string) => contexts.find((c) => c.id === id)?.name ?? id;
  const ctxFree = contexts.filter((c) => !eff.includes(c.id));

  const remoteBadge =
    remote === "checking" ? (
      <span className="rcheck is-checking" role="status" title={`Checking ${test.key} against Jira`}>
        <span className="spin" aria-hidden="true" />
        checking…
      </span>
    ) : remote === "remote-changed" ? (
      <button
        type="button"
        className={dirty ? "rcheck is-conflict" : "rcheck is-changed"}
        title={
          dirty
            ? "Changed in Jira and here — download Jira's version (your local changes would be lost) or push over it"
            : "Changed in Jira since your last sync — click to download it"
        }
        onClick={onRemote}
      >
        <Icon name={dirty ? "warning" : "pull"} />
        {dirty ? "conflict" : "changed in Jira"}
      </button>
    ) : null;

  return (
    <header className="testhead">
      <div className="testhead-top">
        <span className="mono testhead-key">{test.key ?? "local"}</span>
        {editFolder ? (
          <>
            <input
              className="field testhead-folder-input"
              aria-label="Folder"
              list="testimus-folders"
              autoFocus
              defaultValue={test.folder}
              onBlur={(e) => {
                const v = e.target.value.trim() || "/";
                if (v !== test.folder) update((t) => ({ ...t, folder: v }));
                setEditFolder(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") setEditFolder(false);
              }}
            />
            <datalist id="testimus-folders">
              {folders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
          </>
        ) : (
          <button
            type="button"
            className="testhead-folder"
            title="Change the folder — pick one of the Xray folders or type a new path"
            disabled={readOnly}
            onClick={() => {
              onFolders?.();
              setEditFolder(true);
            }}
          >
            <Icon name="folder" />
            {test.folder || "/"}
          </button>
        )}
        <span className="muted testhead-save" aria-live="polite">
          {readOnly
            ? "Claude is editing…"
            : activity
              ? activity
              : saving === "saving"
                ? "Saving…"
                : saving === "saved"
                  ? "Saved"
                  : ""}
        </span>
        <div className="spacer" />
        <Button tone="quiet" icon="claude" onClick={onAsk}>
          Ask Claude
        </Button>
        <Button
          tone="primary"
          icon="push"
          disabled={readOnly || pushing || !canPush || jiraOff}
          title={
            readOnly
              ? "Claude is working — wait for it to finish"
              : jiraOff
                ? "Jira is not connected — connect it from the Jira tab of the test list"
                : pushing
                  ? "The push plan is open"
                  : canPush
                    ? undefined
                    : "No local change since the last sync — nothing to push"
          }
          onClick={onPush}
        >
          Push to Jira
        </Button>
        <Menu
          label="More actions for this test"
          align="right"
          items={menu}
          trigger={({ open, toggle, id }) => (
            <IconButton
              icon="more"
              label="More actions for this test"
              aria-expanded={open}
              aria-controls={open ? id : undefined}
              onClick={toggle}
            />
          )}
        />
      </div>
      <label htmlFor="test-summary" className="sr">
        Summary
      </label>
      <GrowArea
        id="test-summary"
        className="testhead-summary"
        value={test.summary}
        readOnly={readOnly}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.preventDefault();
        }}
        onChange={(e) => update((t) => ({ ...t, summary: e.target.value.replace(/[\r\n]+/g, " ") }))}
      />
      <div className="testhead-chips">
        {test.generatedBy && <GeneratedBadge edited={edited} />}
        <ReviewBadge review={test.review} />
        <span title={remote === "unverified" ? "Not verified against Jira" : undefined}>
          <SyncBadge sync={sync === "remote-changed" ? (dirty ? "modified" : "synced") : sync} />
        </span>
        {remoteBadge}
        {test.status && (
          <Chip small className="status-chip" title="Jira status (informational, never pushed)">
            {test.status}
          </Chip>
        )}
        <span className="vsep" />
        {!details &&
          test.labels.map((l) => (
            <Chip key={l} small>
              {l}
            </Chip>
          ))}
        {!details &&
          test.covers.map((k) => (
            <Chip key={k} small>
              tests <span className="mono ink">{k}</span>
            </Chip>
          ))}
        {test.clonedFrom && (
          <Chip small>
            cloned from <span className="mono ink">{test.clonedFrom}</span>
          </Chip>
        )}
        <Button
          tone="quiet"
          size="sm"
          icon={details ? "up" : "down"}
          aria-expanded={details}
          onClick={() => onDetails(!details)}
        >
          {details ? "Hide details" : "Details"}
        </Button>
      </div>
      {details && (
        <div className="testhead-details">
          <div className="formfield">
            <span className="label">Labels</span>
            <ChipInput
              label="Labels"
              placeholder="Add a label…"
              values={test.labels}
              onChange={readOnly ? undefined : (labels) => update((t) => ({ ...t, labels }))}
            />
          </div>
          <div className="formfield">
            <span className="label">Linked issues</span>
            <ChipInput
              label="Linked issues"
              mono
              placeholder="Add an issue key…"
              values={test.covers}
              onChange={
                readOnly ? undefined : (covers) => update((t) => ({ ...t, covers: covers.map((k) => k.toUpperCase()) }))
              }
            />
          </div>
          <div className="formfield">
            <span className="label">Preconditions</span>
            {/* ponytail: a native select over the project's own preconditions — no free text, so a key Xray
                cannot attach never reaches test.md in the first place */}
            <ChipInput
              label="Preconditions"
              mono
              values={test.preconditions}
              removeLabel={(k) => `Detach ${k}`}
              onChange={readOnly ? undefined : (preconditions) => update((t) => ({ ...t, preconditions }))}
              slot={
                readOnly ? null : preconditions === null ? (
                  <span className="chipinput-hint">loading…</span>
                ) : attachable.length ? (
                  <select
                    className="chipinput-select"
                    aria-label="Attach precondition"
                    value=""
                    onChange={(e) => {
                      const k = e.target.value;
                      if (k) update((t) => ({ ...t, preconditions: [...t.preconditions, k].sort() }));
                    }}
                  >
                    <option value="">{test.preconditions.length ? "attach…" : "attach a precondition…"}</option>
                    {attachable.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.key} — {p.summary}
                      </option>
                    ))}
                  </select>
                ) : !pre.length ? (
                  <span className="chipinput-hint">none in this project</span>
                ) : null
              }
            />
          </div>
          <div className="formfield">
            <span className="label">Claude contexts</span>
            <ChipInput
              label="Claude contexts"
              values={eff}
              render={ctxName}
              removeLabel={(id) => `Detach ${ctxName(id)}`}
              onChange={readOnly || !testContexts ? undefined : (ids) => onContexts(ids)}
              action={
                testContexts?.own != null && !readOnly ? (
                  <button type="button" className="linkbtn" onClick={() => onContexts(null)}>
                    reset to project defaults
                  </button>
                ) : undefined
              }
              slot={
                readOnly || !testContexts ? null : ctxFree.length ? (
                  <select
                    className="chipinput-select"
                    aria-label="Attach context"
                    value=""
                    onChange={(e) => e.target.value && onContexts([...eff, e.target.value])}
                  >
                    <option value="">{eff.length ? "attach…" : "attach a context…"}</option>
                    {ctxFree.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                ) : !contexts.length ? (
                  <button type="button" className="linkbtn chipinput-hint" onClick={onManageContexts}>
                    Manage contexts…
                  </button>
                ) : null
              }
            />
          </div>
          <div className="formfield testhead-desc">
            <label className="label" htmlFor="test-desc">
              Description
            </label>
            <GrowArea
              id="test-desc"
              className="edit desc-edit"
              placeholder="What this test verifies, and the technique used"
              value={test.description}
              readOnly={readOnly}
              onChange={(e) => update((t) => ({ ...t, description: e.target.value }))}
            />
          </div>
        </div>
      )}
    </header>
  );
}
