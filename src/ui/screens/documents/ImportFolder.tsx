import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { List } from "../../components/ui/List.tsx";
import type { ListItemProps } from "../../components/ui/ListItem.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { execute, useRead } from "../../lib/data/query.ts";
import { examplePath } from "../../lib/desktop.ts";
import { message, plural } from "../../lib/format.ts";
import { jobToast } from "../../lib/toast.ts";
import { importClaude } from "../../lib/uploads.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  muted: { color: color.textMuted },
  path: { overflowWrap: "anywhere" },
});

type Scan = CommandOutput<"docs.scanFolder">;
type Found = Scan["files"][number];

function summary(s: Scan, inProject: number, aside: number): string {
  const found = `${plural(s.files.length, "file")} found${s.recursive ? " (sub-folders included)" : ""}`;
  const more = s.truncated ? " — only the first ones were read" : "";
  const there = inProject ? ` · ${inProject} already in the project` : "";
  return `${found}${more} · ${s.documents} can be imported${there} · ${aside} left aside`;
}

const note = (text: string) => <span {...stylex.props(type.small, styles.muted)}>{text}</span>;

// ponytail: a folder's documents, ticked by default, the files left aside with their reason under them — each document
// ticked is copied, converted, then indexed (docs.addFolder); the desktop app hands the folder it picked, a browser types
// its path
export function ImportFolder({ picked, onClose }: { picked: string | null; onClose: () => void }) {
  const app = useApp();
  const client = useQueryClient();
  const [typed, setTyped] = useState(picked ?? "");
  const [dir, setDir] = useState(picked ?? "");
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const read = useRead("docs.scanFolder", { dir, recursive: true }, { enabled: !!dir });
  const scan = dir && read.data ? read.data : null;
  const fresh = !!scan && typed.trim() === dir;
  const docs = scan ? scan.files.filter((f) => f.importable || f.reason === "in-project") : [];
  const aside = scan ? scan.files.filter((f) => !f.importable && f.reason !== "in-project" && f.reason !== "twin") : [];
  const chosen = scan ? scan.files.filter((f) => f.importable && !off[f.rel]) : [];

  const look = () => {
    setError(null);
    setOff({});
    setDir(typed.trim());
  };
  const start = async () => {
    if (!scan || !chosen.length) return;
    setError(null);
    setStarting(true);
    try {
      const { model, effort } = importClaude();
      const r = await execute(client, "docs.addFolder", {
        dir: scan.dir,
        recursive: true,
        files: chosen.map((f) => f.rel),
        triage: true,
        index: true,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
      });
      jobToast(`Importing ${plural(chosen.length, "document")} — started`, r.jobId, app.navigate);
      onClose();
    } catch (e) {
      setStarting(false);
      setError(message(e));
    }
  };
  const item = (f: Found): ListItemProps => {
    if (f.importable)
      return {
        title: (
          <Checkbox checked={!off[f.rel]} label={f.rel} onChange={(on) => setOff((o) => ({ ...o, [f.rel]: !on }))} />
        ),
        trail: f.twin ? note("+ the .pdf of the same name, as its twin") : undefined,
      };
    if (f.reason === "in-project")
      return {
        title: <Checkbox checked={false} label={f.rel} disabled={f.why ?? true} onChange={() => {}} />,
        trail: <Badge size="sm" label="Already in the project" />,
      };
    return { title: f.rel, tooltip: f.rel, disabled: true, trail: note(f.why ?? "left aside") };
  };

  const browser = !picked;
  const readFirst = !fresh;
  return (
    <Modal
      title="Import a folder"
      subtitle={
        scan ? (
          <span {...stylex.props(type.mono, styles.path)}>{scan.dir}</span>
        ) : (
          "Every Word and PDF file of a folder and its sub-folders becomes a document, converted then indexed."
        )
      }
      onClose={onClose}
      busy={starting}
      error={error ?? (read.isError ? message(read.error) : null)}
      onSubmit={() => (readFirst ? look() : void start())}
      footNote={scan ? "Each one is converted, then indexed." : undefined}
      actions={
        <>
          <Button label="Cancel" onClick={onClose} disabled={starting} />
          {readFirst ? (
            <Button
              variant="primary"
              type="submit"
              label="Read the folder"
              loading={read.isFetching}
              disabled={typed.trim() ? false : "Type the folder's path"}
            />
          ) : (
            <Button
              variant="primary"
              type="submit"
              label={`Import ${plural(chosen.length, "document")}`}
              loading={starting}
              disabled={chosen.length ? false : "Tick at least one document"}
            />
          )}
        </>
      }
    >
      <div {...stylex.props(styles.body)}>
        {browser && (
          <Text
            label="Folder"
            value={typed}
            onChange={setTyped}
            spellCheck={false}
            autoFocus
            placeholder={examplePath("D:\\Specs\\J5", "/Users/me/Specs/J5")}
            hint={"The folder's full path on this PC (not a network path \\\\server\\share)"}
          />
        )}
        {scan && note(summary(scan, docs.length - scan.documents, aside.length))}
        {scan && (
          <List
            label="Files found"
            selection="none"
            divided
            items={[...docs, ...aside]}
            getKey={(f) => f.rel}
            renderItem={item}
            groups={[
              { label: "Documents", head: false, keys: docs.map((f) => f.rel) },
              ...(aside.length ? [{ label: `Left aside · ${aside.length}`, keys: aside.map((f) => f.rel) }] : []),
            ]}
          />
        )}
        {!!dir && read.isLoading && note("Reading the folder…")}
      </div>
    </Modal>
  );
}
