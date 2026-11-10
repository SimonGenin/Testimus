import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Table } from "../../components/ui/Table.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { sourcePlace } from "../../lib/fields.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  quote: { margin: 0, color: color.textMuted, overflowWrap: "anywhere" },
  cell: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  intro: { margin: 0, color: color.textMuted },
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
});

const STATE = {
  holds: { tone: "success", icon: "check", label: "Holds" },
  moved: { tone: "info", icon: "arrow-right", label: "Follows its words" },
  lost: { tone: "danger", icon: "alert-circle", label: "Words not found" },
} as const;

const place = (ref: string) => sourcePlace(ref.slice(ref.indexOf("#") + 1));

// ponytail: a video heard again keeps its transcript before until someone decides. The report says, source by source,
// what the new one does to the tests citing the video: most hold by themselves (same moment, same words), some follow
// their words a little earlier or later, a few no longer find them and are to be heard again. Applying rewrites the
// sources that moved; « Put the old one back » undoes the new hearing, and no test was touched meanwhile
export function VideoReport({
  docId,
  video,
  onApply,
}: {
  docId: string;
  video: number;
  onApply: (undo: boolean) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const read = useRead("media.report", { doc: docId, video });
  const r = read.data?.report;
  if (read.data && !r) return null;
  const act = (undo: boolean) => {
    setBusy(true);
    void onApply(undo)
      .then(() => setOpen(false))
      .finally(() => setBusy(false));
  };
  const counts = r
    ? r.rows.length
      ? `${r.holds} source${r.holds === 1 ? "" : "s"} hold${r.holds === 1 ? "s" : ""}, ${r.moved} follow${r.moved === 1 ? "s" : ""} ${r.moved === 1 ? "its" : "their"} words, ${r.lost} no longer find${r.lost === 1 ? "s" : ""} ${r.lost === 1 ? "its" : "theirs"}.`
      : "No test cites what is said in this video."
    : "";
  return (
    <>
      <Banner
        tone="warning"
        title="Heard again"
        actions={
          <>
            <Button size="sm" label="Put the old one back" disabled={busy} onClick={() => act(true)} />
            {r && r.rows.length > 0 ? (
              <Button size="sm" variant="primary" label="See the report" onClick={() => setOpen(true)} />
            ) : (
              <Button size="sm" variant="primary" label="Keep the new one" loading={busy} onClick={() => act(false)} />
            )}
          </>
        }
      >
        {r
          ? `${counts} The transcript before (${r.before.with}) is kept until you decide.`
          : "Reading what it changes…"}
      </Banner>
      {open && r && (
        <Modal
          title="What the new transcription changes"
          subtitle={counts}
          size="lg"
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button label="Close" onClick={() => setOpen(false)} />
              <Button variant="primary" label="Apply" loading={busy} onClick={() => act(false)} />
            </>
          }
          busy={busy}
          footNote="Applying rewrites the sources that follow their words and lets the transcript before go."
        >
          <div {...stylex.props(styles.body)}>
            <p {...stylex.props(type.small, styles.intro)}>
              A source that no longer finds its words stays as it is: its test says so on its step, with the closest
              words now said and the moment to hear again.
            </p>
            <Table
              label="Sources citing the video"
              dense
              rows={r.rows}
              getKey={(row) => `${row.test}-${row.step}-${row.from}-${row.quote}`}
              columns={[
                { key: "test", label: "Test", render: (row) => `${row.test} · step ${row.step}` },
                {
                  key: "source",
                  label: "Source",
                  render: (row) => (
                    <span {...stylex.props(styles.cell)}>
                      <span {...stylex.props(type.code)}>
                        {place(row.from)}
                        {row.to ? ` → ${place(row.to)}` : ""}
                      </span>
                      <span {...stylex.props(type.small, styles.quote)}>« {row.quote} »</span>
                      {row.nearest && (
                        <span {...stylex.props(type.small, styles.quote)}>
                          Closest now, at {place(row.nearest.anchor)}: « {row.nearest.text} »
                        </span>
                      )}
                    </span>
                  ),
                },
                {
                  key: "state",
                  label: "After",
                  render: (row) => <Badge size="sm" {...STATE[row.state]} />,
                },
              ]}
            />
          </div>
        </Modal>
      )}
      {!read.data && !read.isError && (
        <>
          <Skeleton lines={1} />
          <Loading read="media.report" />
        </>
      )}
    </>
  );
}
