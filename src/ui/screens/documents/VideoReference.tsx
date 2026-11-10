import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { CommandOutput } from "../../../core/commands/index.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Table } from "../../components/ui/Table.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { run } from "../../lib/data/client.ts";
import { clock, type VideoShown } from "../../lib/media.ts";
import { errorToast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s4 },
  intro: { margin: 0, color: color.textMuted },
  row: { display: "flex", alignItems: "center", gap: space.s3 },
  grow: { flex: 1 },
});

type Measure = CommandOutput<"media.measure">;
type Reference = CommandOutput<"media.reference">;

const percent = (n: number) => `${Math.round(n * 1000) / 10} %`;

// ponytail: the reference of a video is what a person heard, typed by hand — a few minutes, a sentence a line, each
// starting with its moment. The models on this PC are then heard on those minutes and held against it: the project's
// own words first (a step quotes them), the words wrong, how far a line's anchor is from where its sentence starts,
// the speed. The default is chosen on these figures, never on public benchmarks
export function VideoReference({ docId, video, onClose }: { docId: string; video: VideoShown; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(0);
  const [busy, setBusy] = useState<"save" | "measure" | null>(null);
  const [result, setResult] = useState<Measure | null>(null);
  useEffect(() => {
    let live = true;
    void run<Reference>("media.reference", { doc: docId, video: video.n })
      .then((r) => {
        if (!live) return;
        setText(r.lines.map((l) => `[${clock(l.at)}] ${l.text}`).join("\n"));
        setSaved(r.lines.length);
      })
      .catch((e) => errorToast(e, "The reference could not be read"));
    return () => {
      live = false;
    };
  }, [docId, video.n]);
  const save = async () => {
    setBusy("save");
    try {
      const r = await run<Reference>("media.reference", { doc: docId, video: video.n, text: text ?? "" });
      setSaved(r.lines.length);
      return r.lines.length;
    } catch (e) {
      errorToast(e, "The reference was not saved");
      return 0;
    } finally {
      setBusy(null);
    }
  };
  const measure = async () => {
    if (!(await save())) return;
    setBusy("measure");
    try {
      setResult(await run<Measure>("media.measure", { doc: docId, video: video.n }));
    } catch (e) {
      errorToast(e, "The models could not be measured");
    } finally {
      setBusy(null);
    }
  };
  return (
    <Modal title="Reference transcript" subtitle={video.name} size="lg" onClose={onClose} busy={busy !== null}>
      <div {...stylex.props(styles.body)}>
        <p {...stylex.props(type.small, styles.intro)}>
          Type a few minutes of the video as you hear them, a sentence a line, each starting with its moment — the real
          words, the project's codes and names as they are written. Five minutes are enough.
        </p>
        <Text
          ariaLabel="Reference transcript"
          multiline
          rows={10}
          placeholder={"[02:36] On demande l'autorisation d'ouverture.\n[02:41] Le message de refus apparaît."}
          value={text ?? ""}
          disabled={text === null}
          onChange={setText}
        />
        <div {...stylex.props(styles.row)}>
          <span {...stylex.props(type.small, styles.intro)}>
            {saved ? `${saved} line${saved > 1 ? "s" : ""} kept` : "Nothing kept yet"}
          </span>
          <span {...stylex.props(styles.grow)} />
          <Button label="Save" loading={busy === "save"} onClick={() => void save()} />
          <Button
            variant="primary"
            label="Save and measure the models"
            loading={busy === "measure"}
            disabled={!(text ?? "").trim()}
            onClick={() => void measure()}
          />
        </div>
        {result && (
          <Table
            label="The transcription models measured on this video"
            dense
            rows={result.rows}
            getKey={(r) => r.model}
            empty="No transcription model is installed on this PC."
            columns={[
              { key: "label", label: `${clock(result.from)} → ${clock(result.to)} · ${result.words} words` },
              {
                key: "jargon",
                label: "Project's words right",
                numeric: true,
                render: (r) => (r.jargon === null ? "none said" : `${percent(r.jargon)} of ${r.terms}`),
              },
              { key: "wer", label: "Words wrong", numeric: true, render: (r) => percent(r.wer) },
              {
                key: "timing",
                label: "Anchor off by",
                numeric: true,
                render: (r) => (r.timing === null ? "—" : `${r.timing} s`),
              },
              {
                key: "speed",
                label: "Speed",
                numeric: true,
                render: (r) => `× ${r.speed} · ${r.device === "gpu" ? "card" : "processor"}`,
              },
            ]}
          />
        )}
      </div>
    </Modal>
  );
}
