import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Chip } from "../../components/ui/Chip.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import type { Save } from "../../lib/data/autosave.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { execute, type Key, key } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import type { Info, ProjectJson } from "./project.ts";
import { Group, Hint, Row } from "./Section.tsx";

const styles = stylex.create({
  ask: { display: "flex", gap: space.s5, alignItems: "flex-start", minWidth: 0 },
  chip: { flex: "none", maxWidth: "40%" },
  prompt: { flex: 1, minWidth: 0, margin: 0, color: color.textMuted, whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  tools: { display: "flex", gap: space.s1, flex: "none" },
  set: { boxSizing: "border-box", margin: 0, padding: 0, borderWidth: 0, minWidth: 0 },
  fields: { display: "flex", flexDirection: "column", gap: space.s3, flex: 1, minWidth: 0 },
  acts: { display: "flex", justifyContent: "flex-end", gap: space.s3 },
  plain: { margin: 0 },
});

type Preset = ProjectJson["claude"]["presets"][number];

// ponytail: the presets are one list in project.json — each field saves the whole list with its own change; a quick
// ask needs both a chip and a prompt
function usePresets() {
  const client = useQueryClient();
  const now = () =>
    client.getQueryData<Info>(key("project.info", {}) as unknown as readonly unknown[])?.project.claude.presets ?? [];
  // ponytail: adding or removing first sends what the fields still hold; a field's own save sends at once (flushing
  // from inside it would wait for itself)
  const send = (presets: Preset[], p: string | null = project(), own = false) =>
    execute(client, "project.set", { claude: { presets } }, own ? {} : { flushFirst: [["project.info"]] }, p);
  return { now, send };
}

function QuickAsk({
  preset,
  at,
  editing,
  onEdit,
  onDone,
  onRemove,
}: {
  preset: Preset;
  at: number;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onRemove: () => void;
}) {
  const { now, send } = usePresets();
  const field = (f: keyof Preset): { saveKey: Key; save: Save<string> } => {
    const saveKey: Key = [project(), "project.info", { preset: at, field: f }];
    return {
      saveKey,
      save: async (typed) => {
        const value = typed.trim();
        if (!value) throw new Error(f === "label" ? "A quick ask needs a chip" : "A quick ask needs a prompt");
        const list = now();
        if (list[at]?.[f] === value) return;
        await send(
          list.map((x, k) => (k === at ? { ...x, [f]: value } : x)),
          saveKey[0],
          true,
        );
      },
    };
  };
  const n = at + 1;
  if (!editing)
    return (
      <fieldset aria-label={`Quick ask ${n}`} {...stylex.props(styles.set, styles.ask)}>
        <span {...stylex.props(styles.chip)}>
          <Chip label={preset.label} tone="claude" />
        </span>
        <p {...stylex.props(type.compact, styles.prompt)}>{preset.prompt}</p>
        <span {...stylex.props(styles.tools)}>
          <Button size="sm" variant="quiet" label="Edit" onClick={onEdit} />
          <Button size="sm" variant="quiet" icon="trash" iconOnly label={`Remove quick ask ${n}`} onClick={onRemove} />
        </span>
      </fieldset>
    );
  return (
    <fieldset aria-label={`Quick ask ${n}`} {...stylex.props(styles.set, styles.fields)}>
      <Text aside label="Chip" value={preset.label} placeholder="Label shown as a chip" autoFocus {...field("label")} />
      <Text
        aside
        multiline
        label="Prompt"
        value={preset.prompt}
        placeholder="What Claude is asked to do"
        {...field("prompt")}
      />
      <div {...stylex.props(styles.acts)}>
        <Button size="sm" label="Done" onClick={onDone} />
      </div>
    </fieldset>
  );
}

const DRAFT = (f: string): Key => [project(), "settings.quickAsk", { f }];

export function QuickAsks({ presets }: { presets: Preset[] }) {
  const { now, send } = usePresets();
  const [label, setLabel, clearLabel] = useDraft(DRAFT("label"));
  const [prompt, setPrompt, clearPrompt] = useDraft(DRAFT("prompt"));
  const [adding, setAdding] = useState(!!(label || prompt));
  const [removing, setRemoving] = useState<number | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const change = (next: Preset[]) =>
    send(next).then(
      () => true,
      (e) => {
        errorToast(e, "Could not save the quick asks");
        return false;
      },
    );
  const add = async () => {
    if (!(await change([...now(), { label: label.trim(), prompt: prompt.trim() }]))) return;
    clearLabel();
    clearPrompt();
    setAdding(false);
  };
  return (
    <>
      <Group
        id="claudeproject-quickasks"
        title="Quick asks"
        note="Chips in the Claude dock: a click puts the prompt in the box, to edit before sending."
        footer={!adding && <Button size="sm" icon="plus" label="Add a quick ask" onClick={() => setAdding(true)} />}
      >
        {presets.map((p, i) => (
          <Row key={i}>
            <QuickAsk
              preset={p}
              at={i}
              editing={editing === i}
              onEdit={() => setEditing(i)}
              onDone={() => setEditing(null)}
              onRemove={() => setRemoving(i)}
            />
          </Row>
        ))}
        {!presets.length && !adding && (
          <Row>
            <Hint>No quick ask yet.</Hint>
          </Row>
        )}
        {adding && (
          <Row>
            <fieldset aria-label="New quick ask" {...stylex.props(styles.set, styles.fields)}>
              <Text
                aside
                label="Chip"
                value={label}
                onChange={setLabel}
                placeholder="Name, e.g. Check this step"
                autoFocus
              />
              <Text
                aside
                multiline
                label="Prompt"
                value={prompt}
                onChange={setPrompt}
                placeholder="What Claude is asked"
              />
              <div {...stylex.props(styles.acts)}>
                <Button
                  size="sm"
                  variant="quiet"
                  label="Cancel"
                  onClick={() => {
                    clearLabel();
                    clearPrompt();
                    setAdding(false);
                  }}
                />
                <Button
                  size="sm"
                  variant="primary"
                  label="Add the quick ask"
                  disabled={!label.trim() || !prompt.trim()}
                  onClick={() => void add()}
                />
              </div>
            </fieldset>
          </Row>
        )}
      </Group>
      {removing !== null && presets[removing] && (
        <Modal
          size="sm"
          title={`Remove the quick ask « ${presets[removing].label} »?`}
          confirm={{
            verb: "Remove",
            danger: true,
            onConfirm: async () => {
              await send(now().filter((_, k) => k !== removing));
              setRemoving(null);
            },
          }}
          onClose={() => setRemoving(null)}
        >
          <p {...stylex.props(styles.plain)}>Its prompt is lost, and its chip leaves the Claude dock.</p>
        </Modal>
      )}
    </>
  );
}
