import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.tsx";
import { Checkbox } from "../../../components/ui/Checkbox.tsx";
import { Text } from "../../../components/ui/Text.tsx";
import { useDraft } from "../../../lib/data/autosave.ts";
import { execute, type Key } from "../../../lib/data/query.ts";
import { errorToast, toast } from "../../../lib/toast.ts";
import { color, fontSize, fontWeight, lineHeight, space } from "../../../styles/tokens.stylex.ts";
import { Hint, Stack } from "../Section.tsx";
import { folderPicker } from "./data.ts";

const styles = stylex.create({
  row: { display: "flex", alignItems: "flex-end", gap: space.s3 },
  head: { display: "flex", flexDirection: "column", gap: space.s1 },
  title: {
    color: color.text,
    fontSize: fontSize.titleSm,
    lineHeight: lineHeight.titleSm,
    fontWeight: fontWeight.semibold,
  },
  grow: { flex: 1, minWidth: 0 },
});

const PATH: Key = [null, "settings.models", { f: "folder" }];
const COPY: Key = [null, "settings.models", { f: "copy" }];

// ponytail: a model already on disk (a share, a manual download), checked with one sentence and used in place —
// or copied into the models folder
export function AddFolder() {
  const client = useQueryClient();
  const [path, setPath] = useDraft(PATH);
  const [copy, setCopy] = useDraft(COPY, "");
  const [busy, setBusy] = useState(false);
  const pick = folderPicker();
  const add = async () => {
    if (!path.trim()) return;
    setBusy(true);
    try {
      const r = await execute(
        client,
        "models.add",
        { path: path.trim(), copy: copy === "1" },
        { invalidates: [["models.list"], ["models.catalog"], ["models.packs"], ["system.doctor"]] },
      );
      toast({ kind: "ok", title: `${r.model} added`, detail: `${r.path} · ${r.dims} dimensions` });
      setPath("");
    } catch (e) {
      errorToast(e, "This folder could not be added");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack>
      <div {...stylex.props(styles.head)}>
        <span {...stylex.props(styles.title)}>Add from a folder…</span>
        <Hint>
          A model already on disk (a team share, a manual download): a Hugging Face folder, a .gguf file or a llama.cpp
          folder. It is checked with one sentence and used in place.
        </Hint>
      </div>
      <div {...stylex.props(styles.row)}>
        <div {...stylex.props(styles.grow)}>
          <Text
            ariaLabel="Add from a folder…"
            value={path}
            onChange={setPath}
            spellCheck={false}
            placeholder="\\share\models\bge-m3 or D:\models\Qwen3-Embedding-4B-Q8_0.gguf"
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
            trailing={
              pick ? (
                <Button
                  size="sm"
                  variant="quiet"
                  label="Browse…"
                  onClick={() => void pick({ title: "Model folder" }).then((p) => p && setPath(p))}
                />
              ) : undefined
            }
          />
        </div>
        <Button label={busy ? "Checking…" : "Add"} loading={busy} disabled={!path.trim()} onClick={() => void add()} />
      </div>
      <Checkbox
        label="Copy it into my models folder"
        hint="A share may be slow or read-only."
        checked={copy === "1"}
        onChange={(on) => setCopy(on ? "1" : "")}
      />
    </Stack>
  );
}
