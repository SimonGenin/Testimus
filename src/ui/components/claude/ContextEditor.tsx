import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { type Autosave, useAutosave } from "../../lib/data/autosave.ts";
import { ApiError } from "../../lib/data/client.ts";
import { execute, key } from "../../lib/data/query.ts";
import { desktop, examplePath, pickFolder } from "../../lib/desktop.ts";
import { toBase64 } from "../../lib/files.ts";
import { errorToast } from "../../lib/toast.ts";
import {
  border,
  color,
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  radius,
  space,
} from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Chip } from "../ui/Chip.tsx";
import { ClaudeBlock } from "../ui/ClaudeBlock.tsx";
import { Icon } from "../ui/Icon.tsx";
import { Switch } from "../ui/Switch.tsx";
import { Text } from "../ui/Text.tsx";
import { CONTEXT_READS, type ContextDetail, useContextWrite } from "./contexts.ts";

type Words = { name: string; notes: string };

const styles = stylex.create({
  editor: { display: "flex", flexDirection: "column", gap: space.s6, minWidth: 0 },
  field: { display: "flex", flexDirection: "column", gap: space.s2 },
  label: { fontSize: fontSize.small, lineHeight: lineHeight.small, fontWeight: fontWeight.semibold, color: color.text },
  hint: { fontSize: fontSize.small, lineHeight: lineHeight.small, color: color.textSubtle },
  path: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderStyle: "solid",
    borderWidth: border.width,
    borderColor: color.border,
    borderRadius: radius.r2,
  },
  pathText: {
    flex: 1,
    minWidth: 0,
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  add: { display: "flex", alignItems: "flex-start", gap: space.s2 },
  grow: { flex: 1, minWidth: 0 },
  files: { display: "flex", flexWrap: "wrap", gap: space.s2 },
});

// ponytail: name and notes are one entry of the autosave (one contexts.set for both, 400 ms after the last key, on
// blur, on switching and on closing); paths, files and sharing are one gesture each and go straight to disk; a pending
// text belongs to the project it was typed in (the key carries it)
function useWords(id: string, detail: ContextDetail | undefined): Autosave<Words> {
  const client = useQueryClient();
  const saveKey = key("contexts.show", { id });
  return useAutosave<Words>({
    key: saveKey,
    value: detail ? { name: detail.name, notes: detail.notes } : undefined,
    base: detail?.mtime === undefined ? undefined : String(detail.mtime),
    save: async (v, base) => {
      try {
        const d = (await execute(
          client,
          "contexts.set",
          { id, name: v.name, notes: v.notes, ...(base ? { ifMtime: Number(base) } : {}) },
          { invalidates: CONTEXT_READS },
          saveKey[0],
        )) as unknown as ContextDetail;
        client.setQueryData(saveKey, { ...d, name: v.name, notes: v.notes });
        return d.mtime === undefined ? undefined : String(d.mtime);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "conflict")) errorToast(e, "Could not save the context");
        throw e;
      }
    },
  });
}

export function ContextEditor({ detail, words }: { detail: ContextDetail; words: Autosave<Words> }) {
  const write = useContextWrite();
  const [path, setPath] = useState("");
  const shown = words.value ?? { name: detail.name, notes: detail.notes };
  const id = detail.id;

  const addPath = async (raw: string) => {
    const p = raw.trim();
    if (!p || detail.paths.includes(p)) return;
    try {
      await write("contexts.set", { id, paths: [...detail.paths, p] });
      setPath("");
    } catch (e) {
      errorToast(e, "Could not add the path");
    }
  };
  const removePath = (p: string) =>
    write("contexts.set", { id, paths: detail.paths.filter((x) => x !== p) }).catch((e) =>
      errorToast(e, "Could not remove the path"),
    );
  const addFiles = async (files: File[]) => {
    for (const f of files)
      await toBase64(f)
        .then((dataBase64) => write("contexts.addFile", { id, name: f.name, dataBase64 }))
        .catch((e) => errorToast(e, `Could not copy ${f.name} into the context`));
  };
  const removeFile = (name: string) =>
    write("contexts.removeFile", { id, name }).catch((e) => errorToast(e, `Could not remove ${name}`));
  const share = (shared: boolean) =>
    write("contexts.share", { id, shared }).catch((e) => errorToast(e, "Could not move the context"));

  return (
    <div {...stylex.props(styles.editor)}>
      <Switch
        on={!!detail.shared}
        onChange={(on) => void share(on)}
        label="Shared with every project"
        hint={
          detail.shared
            ? "Every project sees this context and its changes (kept in the Testimus library)."
            : "Kept in this project's folder."
        }
      />
      <Text
        label="Name"
        value={shown.name}
        autosave={words}
        onChange={(name) => words.set((p) => ({ ...(p ?? shown), name }))}
        onBlur={() => void words.flush()}
      />
      <div {...stylex.props(styles.field)}>
        <span {...stylex.props(styles.label)}>Notes</span>
        <ClaudeBlock
          ariaLabel="Notes (markdown, read by Claude)"
          placeholder="Anything Claude should know: conventions, glossary, where things are…"
          submit="autosave"
          plain
          value={shown.notes}
          autosave={words}
          onChange={(notes) => words.set((p) => ({ ...(p ?? shown), notes }))}
          onBlur={() => void words.flush()}
        />
      </div>
      <div {...stylex.props(styles.field)}>
        <span {...stylex.props(styles.label)}>Paths</span>
        <span {...stylex.props(styles.hint)}>
          Folders or files outside the project that Claude may read. Absolute, or relative to the project folder.
        </span>
        {detail.paths.map((p) => (
          <div key={p} {...stylex.props(styles.path)}>
            <Icon name="folder" />
            <span title={p} {...stylex.props(styles.pathText)}>
              {p}
            </span>
            <Button
              size="xs"
              variant="quiet"
              icon="close"
              iconOnly
              label={`Remove path ${p}`}
              onClick={() => void removePath(p)}
            />
          </div>
        ))}
        <div {...stylex.props(styles.add)}>
          <span {...stylex.props(styles.grow)}>
            <Text
              ariaLabel="Path to add"
              icon="folder"
              size="sm"
              placeholder={examplePath("D:\\Specs\\J5", "/Users/you/Specs/J5")}
              value={path}
              onChange={setPath}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void addPath(path);
                }
              }}
            />
          </span>
          <Button size="sm" label="Add" disabled={!path.trim()} onClick={() => void addPath(path)} />
          {desktop() && (
            <Button
              size="sm"
              variant="quiet"
              icon="folder-open"
              label="Browse folder…"
              onClick={() =>
                void pickFolder("Choose a folder Claude may read").then((p) => {
                  if (p) void addPath(p);
                })
              }
            />
          )}
        </div>
      </div>
      <div {...stylex.props(styles.field)}>
        <span {...stylex.props(styles.label)}>Files</span>
        <span {...stylex.props(styles.hint)}>Copied into the context's folder — images, PDFs, anything.</span>
        {detail.files.length > 0 && (
          <div {...stylex.props(styles.files)}>
            {detail.files.map((f) => (
              <Chip
                key={f}
                label={f}
                icon="file"
                square
                onRemove={() => void removeFile(f)}
                removeLabel={`Remove file ${f}`}
              />
            ))}
          </div>
        )}
        <span>
          <Button
            size="sm"
            icon="upload"
            label="Add files…"
            pick={{ multiple: true, onFiles: (files) => void addFiles(files) }}
          />
        </span>
      </div>
    </div>
  );
}

export { useWords };
