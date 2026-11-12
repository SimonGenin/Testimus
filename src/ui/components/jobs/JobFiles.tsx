import * as stylex from "@stylexjs/stylex";
import type { JobEvent } from "../../../core/types.ts";
import type { Screen } from "../../lib/app.ts";
import { plural } from "../../lib/format.ts";
import { type TestNames, testNamed, useTestNames } from "../../lib/labels.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Disclosure } from "../ui/Disclosure.tsx";
import { Icon } from "../ui/Icon.tsx";
import { type } from "../ui/type.ts";

const styles = stylex.create({
  sect: { display: "flex", flexDirection: "column", gap: space.s3 },
  h3: { margin: 0 },
  files: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space.s2 },
  file: { display: "flex", alignItems: "center", gap: space.s3, minWidth: 0 },
  fileIcon: { flex: "none", display: "inline-flex", color: color.textSubtle },
  how: { flex: "none", color: color.textSubtle },
  path: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: color.text },
  file2: { color: color.textMuted },
  folder: { display: "flex", alignItems: "flex-start", gap: space.s3, minWidth: 0 },
  fold: { flex: 1, minWidth: 0 },
});

type Place = { name: string; rest: string; screen: Screen; id: string };

// ponytail: a changed file of a test or a document is said by the test's summary or the document's id (its code),
// then the file inside it — tests/local-4df6ff7b/test.md reads « Ouverture du sectionneur › test.md »
export function placeOfPath(path: string, names: TestNames): Place | null {
  const m = /^(tests|docs)\/([^/]+)\/(.*)$/.exec(path.replace(/\\/g, "/"));
  if (!m) return null;
  return m[1] === "tests"
    ? { name: testNamed(names, m[2]), rest: m[3], screen: "tests", id: m[2] }
    : { name: m[2], rest: m[3], screen: "documents", id: m[2] };
}

// ponytail: beyond 50 files the list is cut by folder — a test's, a document's, or another folder of the project
const FOLD_FROM = 50;
const folderOf = (p: string) =>
  /^(tests|docs)\/[^/]+(?=\/)/.exec(p)?.[0] ?? (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : p);

type How = Map<string, "added" | "deleted">;
type Folder = { path: string; files: string[]; count: number };

function changedOf(events: JobEvent[]): { files: string[]; how: How; folders: Folder[]; total: number } {
  const how: How = new Map();
  const files = new Set<string>();
  const kept = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "changed") continue;
    for (const p of e.paths) files.add(p);
    for (const p of e.added ?? []) how.set(p, "added");
    for (const p of e.removed ?? []) how.set(p, "deleted");
    for (const f of e.folders ?? []) kept.set(f.path, (kept.get(f.path) ?? 0) + f.files);
  }
  const byFolder = new Map<string, string[]>();
  for (const p of files) byFolder.set(folderOf(p), [...(byFolder.get(folderOf(p)) ?? []), p]);
  const folders = [...new Set([...byFolder.keys(), ...kept.keys()])].sort().map((path) => {
    const list = byFolder.get(path) ?? [];
    return { path, files: list, count: Math.max(list.length, kept.get(path) ?? 0) };
  });
  return { files: [...files], how, folders, total: folders.reduce((n, f) => n + f.count, 0) };
}

function FileRow({ path, how, onGo }: { path: string; how: How; onGo: (screen: Screen, id: string) => void }) {
  const names = useTestNames();
  const at = placeOfPath(path, names);
  return (
    <li {...stylex.props(styles.file)}>
      <span {...stylex.props(styles.fileIcon)}>
        <Icon name={how.get(path) === "added" ? "plus" : how.get(path) === "deleted" ? "trash" : "file"} size="sm" />
      </span>
      <span {...stylex.props(type.compact, styles.path)}>
        {at ? (
          <>
            {at.name} <span {...stylex.props(type.code, styles.file2)}>› {at.rest}</span>
          </>
        ) : (
          <span {...stylex.props(type.code)}>{path}</span>
        )}
      </span>
      <span {...stylex.props(type.small, styles.how)}>{how.get(path) ?? "modified"}</span>
      {how.get(path) !== "deleted" && at && (
        <Button
          size="xs"
          variant="quiet"
          iconOnly
          icon="arrow-right"
          label={`Open « ${at.name} » in ${at.screen === "tests" ? "Tests" : "Documents"}`}
          onClick={() => onGo(at.screen, at.id)}
        />
      )}
    </li>
  );
}

function FolderRow({ folder, how, onGo }: { folder: Folder; how: How; onGo: (screen: Screen, id: string) => void }) {
  const names = useTestNames();
  const at = placeOfPath(`${folder.path}/x`, names);
  const name = at ? at.name : folder.path;
  return (
    <li {...stylex.props(styles.folder)}>
      <span {...stylex.props(styles.fileIcon)}>
        <Icon name="folder" size="sm" />
      </span>
      <div {...stylex.props(styles.fold)}>
        {folder.files.length ? (
          <Disclosure quiet summary={name} meta={plural(folder.count, "file")}>
            <ul {...stylex.props(styles.files)}>
              {folder.files.map((p) => (
                <FileRow key={p} path={p} how={how} onGo={onGo} />
              ))}
            </ul>
          </Disclosure>
        ) : (
          <span {...stylex.props(type.compact, styles.path)}>
            {name} <span {...stylex.props(type.small, styles.how)}>· {plural(folder.count, "file")}</span>
          </span>
        )}
      </div>
      {at && (
        <Button
          size="xs"
          variant="quiet"
          iconOnly
          icon="arrow-right"
          label={`Open « ${name} » in ${at.screen === "tests" ? "Tests" : "Documents"}`}
          onClick={() => onGo(at.screen, at.id)}
        />
      )}
    </li>
  );
}

// ponytail: the files a job changed — one per line, or past 50 (a folder import's thousands, or a log that kept only
// their folders) the folders they are in with how many, each opening on its files
export function JobFiles({ events, onGo }: { events: JobEvent[]; onGo: (screen: Screen, id: string) => void }) {
  const { files, how, folders, total } = changedOf(events);
  if (!total) return null;
  const byFolder = total > FOLD_FROM || files.length < total;
  const title = `Files changed · ${total}`;
  return (
    <section aria-label={title} {...stylex.props(styles.sect)}>
      <h3 {...stylex.props(type.caption, styles.h3)}>{title}</h3>
      <ul {...stylex.props(styles.files)}>
        {byFolder
          ? folders.map((f) => <FolderRow key={f.path} folder={f} how={how} onGo={onGo} />)
          : files.map((p) => <FileRow key={p} path={p} how={how} onGo={onGo} />)}
      </ul>
    </section>
  );
}
