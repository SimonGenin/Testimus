import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Text } from "../../components/ui/Text.tsx";
import type { Save } from "../../lib/data/autosave.ts";
import { useDraft } from "../../lib/data/autosave.ts";
import { project } from "../../lib/data/client.ts";
import { execute, type Key, key } from "../../lib/data/query.ts";
import { errorToast } from "../../lib/toast.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";
import type { Info, ProjectJson } from "./project.ts";
import { Hint, Stack } from "./Section.tsx";

const styles = stylex.create({
  ask: {
    display: "flex",
    gap: space.s3,
    alignItems: "flex-start",
    paddingBottom: space.s4,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
  },
  set: { boxSizing: "border-box", margin: 0, padding: 0, borderWidth: 0, minWidth: 0 },
  fields: { display: "flex", flexDirection: "column", gap: space.s3, flex: 1, minWidth: 0 },
  close: { paddingTop: space.s6 },
  acts: { display: "flex", justifyContent: "flex-end", gap: space.s3 },
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

function QuickAsk({ preset, at, onRemove }: { preset: Preset; at: number; onRemove: () => void }) {
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
  return (
    <fieldset aria-label={`Quick ask ${n}`} {...stylex.props(styles.set, styles.ask)}>
      <div {...stylex.props(styles.fields)}>
        <Text label="Chip" value={preset.label} placeholder="Label shown as a chip" {...field("label")} />
        <Text
          multiline
          label="Prompt"
          value={preset.prompt}
          placeholder="What Claude is asked to do"
          {...field("prompt")}
        />
      </div>
      <div {...stylex.props(styles.close)}>
        <Button size="sm" variant="quiet" icon="close" iconOnly label={`Remove quick ask ${n}`} onClick={onRemove} />
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
    <Card
      title="Quick asks"
      actions={
        !adding && (
          <Button size="sm" variant="quiet" icon="plus" label="Add a quick ask" onClick={() => setAdding(true)} />
        )
      }
    >
      <Stack>
        {presets.map((p, i) => (
          <QuickAsk key={i} preset={p} at={i} onRemove={() => void change(now().filter((_, k) => k !== i))} />
        ))}
        {!presets.length && !adding && <Hint>No quick ask yet.</Hint>}
        {adding && (
          <fieldset aria-label="New quick ask" {...stylex.props(styles.set, styles.fields)}>
            <Text label="Chip" value={label} onChange={setLabel} placeholder="Name, e.g. Check this step" autoFocus />
            <Text multiline label="Prompt" value={prompt} onChange={setPrompt} placeholder="What Claude is asked" />
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
        )}
        <Hint>Chips in the Claude dock: a click puts the prompt in the box, where you can edit it before sending.</Hint>
      </Stack>
    </Card>
  );
}
