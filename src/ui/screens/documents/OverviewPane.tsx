import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Menu } from "../../components/ui/Menu.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { TextDiff } from "../../components/ui/TextDiff.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import type { Save } from "../../lib/data/autosave.ts";
import { execute, key, useRead } from "../../lib/data/query.ts";
import { changesLine, OVERVIEW_TITLE, type OverviewShown, updatedLine } from "../../lib/overview.ts";
import { useProjectJobs } from "../../lib/projectJobs.ts";
import { errorToast, jobToast } from "../../lib/toast.ts";
import { color, size, space } from "../../styles/tokens.stylex.ts";
import { useSetProject } from "../settings/project.ts";
import { useClaudeOffline } from "./ConvertDoc.tsx";
import { OverviewText } from "./OverviewText.tsx";

const styles = stylex.create({
  pane: {
    boxSizing: "border-box",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: space.s5,
    paddingBlock: space.s7,
    paddingInline: space.s8,
  },
  head: { display: "flex", alignItems: "flex-start", flexWrap: "wrap", gap: space.s4 },
  titles: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s1 },
  title: { margin: 0, color: color.text },
  sub: { margin: 0, color: color.textMuted },
  acts: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.s3 },
  body: { maxWidth: size.reading, display: "flex", flexDirection: "column", gap: space.s4 },
});

// ponytail: docs/OVERVIEW.md on the Documents screen — the text Claude wrote (rendered, or a field to edit it by hand),
// the switch that gives it to every run, Update now and Rewrite from scratch, and what the last update changed
export function OverviewPane() {
  const app = useApp();
  const client = useQueryClient();
  const shown = useRead("docs.overviewShow", {});
  const setProject = useSetProject();
  const offline = useClaudeOffline();
  const [started, setStarted] = useState<string | undefined>();
  const jobs = useProjectJobs([started]);
  const running = jobs.find((j) => j.kind === "docs.overview" && j.status === "running");
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState<"full" | null>(null);
  const [diff, setDiff] = useState(false);
  const saveKey = key("docs.overviewShow", {});
  const o = shown.data;

  const option = (next: { enabled: boolean; inEveryRun: boolean }) =>
    setProject({ claude: { overview: next } }, "how the documents fit together");
  const update = async (mode: "auto" | "full") => {
    try {
      const r = await execute(client, "docs.overview", { mode }, { invalidates: "none" });
      const jobId = (r as { jobId?: string }).jobId;
      setStarted(jobId);
      jobToast(mode === "full" ? "Rewriting it from scratch — started" : "Updating it — started", jobId, app.openJob);
    } catch (e) {
      errorToast(e, "Could not start the update");
    }
  };
  const save: Save<string> = async (text, base) => {
    const out = await execute(
      client,
      "docs.overviewSave",
      { text, ...(base ? { ifMtime: Number(base) } : {}) },
      { invalidates: "none" },
      saveKey[0],
    );
    client.setQueryData<OverviewShown>(saveKey as unknown as readonly unknown[], (old) =>
      old ? { ...old, text, mtime: out.mtime } : old,
    );
    return String(out.mtime);
  };

  if (!o)
    return (
      <div {...stylex.props(styles.pane)}>
        <Skeleton lines={8} />
        <Loading read="docs.overviewShow" />
      </div>
    );
  const busy = running ? "Claude is writing it" : offline || false;
  if (!o.exists)
    return (
      <div {...stylex.props(styles.pane)}>
        <EmptyState
          icon="layers"
          title={OVERVIEW_TITLE}
          text="Claude can write a page on your documents and how they link: what each one is, which refers to, amends or contradicts which. It is updated after each import, only where the import changes it, and can be given to every Claude run."
          actions={
            <Button
              variant="claude"
              icon="claude"
              label={o.enabled ? "Write it now" : "Turn on and write it"}
              disabled={busy}
              onClick={() =>
                void (o.enabled ? Promise.resolve(true) : option({ enabled: true, inEveryRun: true })).then((ok) =>
                  ok ? update("full") : undefined,
                )
              }
            />
          }
        />
      </div>
    );
  const changed = o.changed.modified.length + o.changed.added.length + o.changed.removed.length > 0;
  return (
    <section aria-label={OVERVIEW_TITLE} {...stylex.props(styles.pane)}>
      <div {...stylex.props(styles.head)}>
        <div {...stylex.props(styles.titles)}>
          <h2 {...stylex.props(type.titleLg, styles.title)}>{OVERVIEW_TITLE}</h2>
          <p {...stylex.props(type.small, styles.sub)}>
            <span {...stylex.props(type.mono)}>{o.path}</span> · {updatedLine(o)}
          </p>
        </div>
        <div {...stylex.props(styles.acts)}>
          <Switch
            on={o.inEveryRun}
            label="Give it to every Claude run"
            disabled={o.enabled ? false : "Turn it on first"}
            onChange={(on) => void option({ enabled: o.enabled, inEveryRun: on })}
          />
          <Button
            size="sm"
            variant="quiet"
            icon={editing ? "check" : "text"}
            label={editing ? "Done" : "Edit"}
            pressed={editing}
            disabled={running ? "Claude is writing it" : false}
            onClick={() => setEditing((e) => !e)}
          />
          {o.enabled && (
            <Button
              size="sm"
              variant="claude-quiet"
              label="Update now"
              disabled={busy}
              onClick={() => void update("auto")}
            />
          )}
          {o.enabled && (
            <Menu
              align="end"
              entries={[{ label: "Rewrite from scratch…", icon: "refresh", onSelect: () => setAsking("full") }]}
              trigger={<Button size="sm" variant="quiet" icon="more" iconOnly label="More" disabled={busy} />}
            />
          )}
        </div>
      </div>
      {!o.enabled && (
        <Banner
          tone="neutral"
          compact
          actions={
            <Button
              size="sm"
              variant="claude-quiet"
              label="Turn on"
              onClick={() => void option({ enabled: true, inEveryRun: true })}
            />
          }
        >
          Off for this project: Claude does not update it after an import, and no run is told to read it.
        </Banner>
      )}
      {running ? (
        <Banner
          tone="claude"
          compact
          icon="spinner"
          actions={<Button size="sm" label="Show the job" onClick={() => app.openJob(running.id)} />}
        >
          {running.message || "Claude is writing it."}
        </Banner>
      ) : (
        o.updatedAt &&
        changed && (
          <Banner
            tone="claude"
            compact
            actions={o.last ? <Button size="sm" label="Show changes" onClick={() => setDiff(true)} /> : undefined}
          >
            {changesLine(o.changed)}
          </Banner>
        )
      )}
      {o.enabled && !running && o.pending.length > 0 && (
        <Banner tone="info" compact>
          {`Changed since the last update: ${o.pending.map((p) => `« ${p.title} »`).join(", ")}. Update now brings it up to date.`}
        </Banner>
      )}
      <div {...stylex.props(styles.body)}>
        {editing ? (
          <Text
            multiline
            rows={20}
            label="The text, in markdown"
            value={o.text}
            save={save}
            saveKey={saveKey}
            base={String(o.mtime)}
            lockedBy={running ? "claude" : null}
            hint="Saved as you type. Claude keeps what you write: the next update merges into it."
          />
        ) : (
          <OverviewText text={o.text} />
        )}
      </div>
      {asking && (
        <Modal
          title="Rewrite it from scratch?"
          size="sm"
          confirm={{
            verb: "Rewrite",
            icon: "refresh",
            onConfirm: () => {
              setAsking(null);
              void update("full");
            },
          }}
          onClose={() => setAsking(null)}
        >
          Claude writes the whole page again from the documents. What it or your team wrote so far, hand edits included,
          is replaced; Show changes keeps the difference.
        </Modal>
      )}
      {diff && o.last && (
        <Modal title="Changes of the last update" size="lg" onClose={() => setDiff(false)}>
          <TextDiff label="Changes of the last update" before={o.last.before} after={o.last.after} />
        </Modal>
      )}
    </section>
  );
}
