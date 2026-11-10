import * as stylex from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { CommandOutput } from "../../../../core/commands/index.ts";
import { Button } from "../../../components/ui/Button.tsx";
import { Modal } from "../../../components/ui/Modal.tsx";
import { Table } from "../../../components/ui/Table.tsx";
import { type } from "../../../components/ui/type.ts";
import { run } from "../../../lib/data/client.ts";
import { invalidate, useRead } from "../../../lib/data/query.ts";
import { errorToast, toast } from "../../../lib/toast.ts";
import { color, space } from "../../../styles/tokens.stylex.ts";
import type { SpeechModel } from "./data.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s5 },
  intro: { margin: 0, color: color.textMuted },
  title: { margin: 0 },
  part: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  lines: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  none: { color: color.textMuted },
});

type Measures = CommandOutput<"media.measures">;
type Measured = Measures["videos"][number];

const percent = (n: number) => `${Math.round(n * 1000) / 10} %`;
const day = (at: string) => new Date(at).toLocaleDateString("en-GB");
const names = new Intl.DisplayNames(["en"], { type: "language" });
const language = (code?: string) => {
  if (!code) return "—";
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
};
const keyOf = (v: Measured) => `${v.doc}#${v.video}`;

// ponytail: the models held against the project's own videos (VIDEO-SOURCES.md §3.6) — the videos a person typed a
// reference for, what each model made of them the last time, and the same by language: the default is chosen on these
// figures. A measure is a job that hears the reference's minutes again with the model in use; one at a time
export function MeasureDialog({ models, onClose }: { models: SpeechModel[]; onClose: () => void }) {
  const client = useQueryClient();
  const read = useRead("media.measures", {});
  const [measuring, setMeasuring] = useState<string | null>(null);
  const active = models.find((m) => m.active);
  const labelOf = (id: string) => models.find((m) => m.id === id)?.label ?? id;
  const measure = async (v: Measured) => {
    setMeasuring(keyOf(v));
    try {
      await run("media.measure", { doc: v.doc, video: v.video, ...(active ? { models: [active.id] } : {}) });
      await invalidate(client, [["media.measures"], ["models.speech"]]);
      toast({ tone: "success", title: `${v.name} measured` });
    } catch (e) {
      errorToast(e, `${v.name} could not be measured`);
    } finally {
      setMeasuring(null);
    }
  };
  const data = read.data;
  return (
    <Modal
      title="Measure the transcription models"
      icon="verify"
      size="lg"
      onClose={onClose}
      error={read.isError ? `The measures could not be read: ${read.error.message}` : null}
      footNote="A measure hears the minutes of the reference again; nothing of the document changes."
    >
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(type.small, styles.intro)}>
          The project's own words written right come first — a step quotes them — then the words wrong. A video gets a
          reference in Documents › Video › Reference…: a few minutes typed as a person hears them.
        </p>
        <Table
          label="Videos with a reference transcript"
          dense
          middle
          loading={read.isPending}
          rows={data?.videos ?? []}
          getKey={keyOf}
          empty="No video has a reference transcript yet."
          columns={[
            { key: "name", label: "Video" },
            { key: "language", label: "Language", render: (v) => language(v.language) },
            {
              key: "measures",
              label: "Last measures",
              render: (v) =>
                v.measures.length ? (
                  <div {...stylex.props(styles.lines)}>
                    {v.measures.map((m) => (
                      <span key={m.model}>
                        {labelOf(m.model)}: {percent(m.wer)} of the words wrong
                        {m.jargon !== undefined && m.jargon !== null
                          ? `, ${percent(m.jargon)} of the project's words right`
                          : ""}
                        {m.timing !== undefined && m.timing !== null ? `, anchors off by ${m.timing} s` : ""} ·{" "}
                        {day(m.at)}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span {...stylex.props(styles.none)}>Not measured yet</span>
                ),
            },
            {
              key: "act",
              label: "",
              render: (v) => (
                <Button
                  size="sm"
                  icon="verify"
                  label={active ? `Measure with ${active.label}` : "Measure"}
                  loading={measuring === keyOf(v)}
                  disabled={
                    !active
                      ? "No transcription model is in use on this PC"
                      : measuring !== null && measuring !== keyOf(v)
                        ? "One measure at a time"
                        : false
                  }
                  onClick={() => void measure(v)}
                />
              ),
            },
          ]}
        />
        {!!data?.byLanguage.length && (
          <div {...stylex.props(styles.part)}>
            <h3 {...stylex.props(type.small, type.strong, styles.title)}>By language</h3>
            <Table
              label="The models by language"
              dense
              rows={data.byLanguage}
              getKey={(r) => `${r.language} ${r.model}`}
              columns={[
                { key: "language", label: "Language", render: (r) => language(r.language) },
                { key: "model", label: "Model", render: (r) => labelOf(r.model) },
                { key: "videos", label: "Videos", numeric: true },
                {
                  key: "jargon",
                  label: "Project's words right",
                  numeric: true,
                  render: (r) => (r.jargon === undefined || r.jargon === null ? "none said" : percent(r.jargon)),
                },
                { key: "wer", label: "Words wrong", numeric: true, render: (r) => percent(r.wer) },
              ]}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
