import { useState } from "react";
import type { SyncState, Test } from "../../../core/types.ts";
import {
  Button,
  Chip,
  ChipInput,
  GrowArea,
  Icon,
  ReviewBadge,
  Segmented,
  SyncBadge,
} from "../../components/ui/index.ts";
import type { StepLayout } from "./StepCard.tsx";

export function TestHeader({
  test,
  sync,
  saving,
  layout,
  folders,
  readOnly,
  onLayout,
  onPush,
  update,
}: {
  test: Test;
  sync: SyncState;
  saving: "idle" | "saving" | "saved";
  layout: StepLayout;
  folders: string[];
  readOnly?: boolean;
  onLayout: (l: StepLayout) => void;
  onPush: () => void;
  update: (fn: (t: Test) => Test) => void;
}) {
  const [editFolder, setEditFolder] = useState(false);
  const [details, setDetails] = useState(false);
  return (
    <header className="testhead">
      <div className="testhead-top">
        <span className="mono testhead-key">{test.key ?? "No key yet"}</span>
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
            title="Change the folder"
            disabled={readOnly}
            onClick={() => setEditFolder(true)}
          >
            <Icon name="folder" />
            {test.folder || "/"}
          </button>
        )}
        <span className="muted testhead-save" aria-live="polite">
          {saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : ""}
        </span>
        <div className="spacer" />
        <Segmented
          label="Step layout"
          value={layout}
          onChange={onLayout}
          options={[
            { value: "stacked", label: "Stacked" },
            { value: "split", label: "Side by side" },
          ]}
        />
        <Button tone="primary" icon="push" disabled={readOnly} onClick={onPush}>
          Push to Jira
        </Button>
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
        <ReviewBadge review={test.review} />
        <SyncBadge sync={sync} />
        <span className="vsep" />
        {test.labels.map((l) => (
          <Chip key={l} small>
            {l}
          </Chip>
        ))}
        {test.covers.map((k) => (
          <Chip key={k} small>
            covers <span className="mono ink">{k}</span>
          </Chip>
        ))}
        {test.clonedFrom && (
          <Chip small>
            cloned from <span className="mono ink">{test.clonedFrom}</span>
          </Chip>
        )}
        {!readOnly && (
          <Button
            tone="quiet"
            size="sm"
            icon={details ? "up" : "plus"}
            aria-expanded={details}
            onClick={() => setDetails(!details)}
          >
            {details ? "Done" : "Add"}
          </Button>
        )}
      </div>
      {details && (
        <div className="testhead-details">
          <div className="formfield">
            <span className="label">Labels</span>
            <ChipInput
              label="Labels"
              placeholder="Add a label…"
              values={test.labels}
              onChange={(labels) => update((t) => ({ ...t, labels }))}
            />
          </div>
          <div className="formfield">
            <span className="label">Covers</span>
            <ChipInput
              label="Covers"
              mono
              placeholder="Add an issue key…"
              values={test.covers}
              onChange={(covers) => update((t) => ({ ...t, covers }))}
            />
          </div>
        </div>
      )}
    </header>
  );
}
