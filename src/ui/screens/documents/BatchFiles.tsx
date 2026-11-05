import * as stylex from "@stylexjs/stylex";
import { Button } from "../../components/ui/Button.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { baseName, desktop, pathOf, pickFiles } from "../../lib/desktop.ts";
import { isPhoto, PHOTO_ACCEPT, PHOTO_EXTENSIONS } from "../../lib/media.ts";
import { readBase64 } from "../../lib/uploads.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  box: { display: "flex", flexDirection: "column", gap: space.s3 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space.s1 },
  row: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  icon: { display: "inline-flex", color: color.textMuted },
  off: { display: "inline-flex", color: color.warning },
  name: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  why: { color: color.warning, flexShrink: 0 },
  hint: { margin: 0, color: color.textMuted },
  pick: { display: "flex" },
});

export type PickedFile = { name: string; path?: string; file?: File };

const LATER = /\.(heic|heif|mp4|mov|mkv|avi|webm|mp3|m4a|wav)$/i;

// ponytail: why a picked file will be left out, as the core says it — a later version, or not a photo at all
export const leftOut = (name: string) => (isPhoto(name) ? null : LATER.test(name) ? "a later version" : "not a photo");

export const pickedOf = (files: File[]): PickedFile[] =>
  files.map((f) => ({ name: f.name, ...(pathOf(f) ? { path: pathOf(f) } : { file: f }) }));

// ponytail: what the core is sent — a path in the desktop app, the content otherwise; what it refuses it says why
export async function filesInput(
  picked: PickedFile[],
): Promise<({ path: string } | { name: string; dataBase64: string })[]> {
  const out: ({ path: string } | { name: string; dataBase64: string })[] = [];
  for (const p of picked)
    if (p.path) out.push({ path: p.path });
    else if (p.file) out.push({ name: p.name, dataBase64: await readBase64(p.file) });
  return out;
}

// ponytail: the photos picked for a batch, each removable before anything is sent, and the way to pick more
export function BatchFiles({
  files,
  onChange,
  disabled = false,
}: {
  files: PickedFile[];
  onChange: (files: PickedFile[]) => void;
  disabled?: boolean;
}) {
  const add = (more: PickedFile[]) =>
    onChange([...files, ...more.filter((m) => !files.some((f) => (f.path ?? f.name) === (m.path ?? m.name)))]);
  const native = desktop();
  return (
    <div {...stylex.props(styles.box)}>
      {files.length > 0 && (
        <ul aria-label="Files of the batch" {...stylex.props(styles.list)}>
          {files.map((f, i) => {
            const why = leftOut(f.name);
            return (
              <li key={f.path ?? `${f.name}-${i}`} {...stylex.props(type.compact, styles.row)}>
                <span {...stylex.props(why ? styles.off : styles.icon)}>
                  <Icon name={why ? "alert-triangle" : "image"} size="sm" />
                </span>
                <span title={f.path ?? f.name} {...stylex.props(styles.name)}>
                  {f.name}
                </span>
                {why && <span {...stylex.props(type.small, styles.why)}>Left out: {why}</span>}
                <Button
                  size="sm"
                  variant="quiet"
                  iconOnly
                  icon="close"
                  label={`Remove ${f.name}`}
                  disabled={disabled}
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                />
              </li>
            );
          })}
        </ul>
      )}
      <span {...stylex.props(styles.pick)}>
        <Button
          icon="image"
          label={files.length ? "Add more photos…" : "Choose photos…"}
          disabled={disabled}
          pick={native ? undefined : { accept: PHOTO_ACCEPT, multiple: true, onFiles: (fs) => add(pickedOf(fs)) }}
          onClick={
            native
              ? () =>
                  void pickFiles("Add photos", [{ name: "Photos", extensions: PHOTO_EXTENSIONS }], true).then((ps) =>
                    add(ps.map((p) => ({ name: baseName(p), path: p }))),
                  )
              : undefined
          }
        />
      </span>
      <p {...stylex.props(type.small, styles.hint)}>
        JPEG, PNG or WebP photos, copied into the project. Videos, sound and HEIC photos come in a later version.
      </p>
    </div>
  );
}
