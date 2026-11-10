import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { ChipField } from "../../components/ui/ChipField.tsx";
import { Facts } from "../../components/ui/Facts.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useRead } from "../../lib/data/query.ts";
import { clock, type VideoShown } from "../../lib/media.ts";
import { space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s5 },
  part: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: space.s4 },
});

export type VideoChoices = {
  spoken: string[];
  track: number | null;
  from: string;
  to: string;
  /** hear every piece again, even those nothing changed for */
  all: boolean;
};

export const minutes = (seconds: number) =>
  seconds < 90
    ? "about a minute"
    : seconds < 5400
      ? `about ${Math.round(seconds / 60)} min`
      : `about ${(seconds / 3600).toFixed(1)} h`;

const size = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

// ponytail: what a video will cost on this PC, said before it is heard — its length and weight, the time to hear it
// (measured here when a video was heard before, else a guess), Claude's share, and a word when it is very long
export function VideoEstimate({ docId, video }: { docId: string; video: number }) {
  const read = useRead("media.estimate", { doc: docId, video });
  const e = read.data;
  if (!e) return read.isError ? null : <Loading read="media.estimate" />;
  return (
    <>
      <Facts
        size="sm"
        label="What the video will take"
        items={[
          { label: "Length · weight", value: `${clock(e.duration)}${e.bytes ? ` · ${size(e.bytes)}` : ""}` },
          e.audio &&
            !e.missing && {
              label: "On this PC",
              value: `${minutes(e.speechSeconds)} to hear it${e.device === "gpu" ? " on the graphics card" : ""}, ${minutes(e.framesSeconds)} to look through it · ${e.measured ? "measured here" : "estimated"}`,
            },
          !!e.withCardSeconds && {
            label: "With the graphics card",
            value: `${minutes(e.withCardSeconds)} to hear it, once the engine's NVIDIA build is installed (Settings › Models › Transcription)`,
          },
          e.claude.runs > 0 && {
            label: "Claude's share",
            value: `About ${e.claude.runs} runs, ${e.claude.images} pictures`,
          },
          e.disk.freeMB !== null && {
            label: "Room",
            value: `About ${size(e.disk.needMB * 1e6)} with what is drawn from it · ${size(e.disk.freeMB * 1e6)} free`,
          },
        ]}
      />
      {e.missing && (
        <Banner tone="warning" compact>
          {e.missing === "engine"
            ? "The transcription engine is not on this PC: the video will have its pictures, no transcript. Install it in Settings › Models › Transcription."
            : "No transcription model is on this PC: the video will have its pictures, no transcript. Install one in Settings › Models › Transcription."}
        </Banner>
      )}
      {e.long && (
        <Banner tone="info" compact>
          Longer than two hours: you can transcribe a part of it only (From, To).
        </Banner>
      )}
      {e.disk.freeMB !== null && e.disk.freeMB < e.disk.needMB && (
        <Banner tone="danger" compact>
          Not enough room on the project's drive for this video and what is drawn from it.
        </Banner>
      )}
    </>
  );
}

// ponytail: what is heard of a video is the team's choice, kept on the video — the languages spoken in it (none:
// the project's, else each passage's own), one sound track or all of them mixed, a part of it or the whole. Hearing
// again redoes only the pieces these, the model or the glossary changed; what people corrected stays theirs
export function HearAgain({
  docId,
  video,
  onClose,
  onHear,
}: {
  docId: string;
  video: VideoShown;
  onClose: () => void;
  onHear: (choices: VideoChoices) => Promise<unknown>;
}) {
  const languages = useRead("media.glossary", {}).data?.languages ?? [];
  const [c, setC] = useState<VideoChoices>({
    spoken: video.spoken ?? [],
    track: video.track ?? null,
    from: video.range ? clock(video.range.from) : "",
    to: video.range ? clock(video.range.to) : "",
    all: false,
  });
  const [busy, setBusy] = useState(false);
  const tracks = video.tracks.map((t, i) => ({
    value: String(i),
    label: [`Track ${i + 1}`, t.title, t.language].filter(Boolean).join(" · "),
  }));
  return (
    <Modal
      title="Hear the video again"
      subtitle={video.name}
      icon="refresh"
      size="md"
      onClose={onClose}
      busy={busy}
      actions={
        <>
          <Button label="Cancel" onClick={onClose} />
          <Button
            variant="primary"
            icon="refresh"
            label="Hear again"
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onHear(c).finally(() => setBusy(false));
            }}
          />
        </>
      }
      footNote="Only the pieces these choices, the model or the glossary change are heard again; a report then says what it does to the tests citing the video."
    >
      <div {...stylex.props(styles.body)}>
        <ChipField
          label="Languages spoken in this video"
          showLabel
          values={c.spoken}
          choices={languages.map((l) => ({ value: l.code, label: l.name }))}
          placeholder="The project's languages"
          onChange={(spoken) => setC({ ...c, spoken })}
        />
        {tracks.length > 1 && (
          <Select
            label="Sound"
            showLabel
            block
            value={c.track === null ? "all" : String(c.track)}
            options={[{ value: "all", label: `All ${tracks.length} tracks, mixed` }, ...tracks]}
            onChange={(v) => setC({ ...c, track: v === "all" ? null : Number(v) })}
            hint="A screen recording keeps the microphone and the PC's sound on two tracks."
          />
        )}
        <div {...stylex.props(styles.part)}>
          <Text
            label="From"
            placeholder="00:00"
            value={c.from}
            onChange={(from) => setC({ ...c, from })}
            hint="Leave both empty for the whole video."
          />
          <Text label="To" placeholder={clock(video.duration)} value={c.to} onChange={(to) => setC({ ...c, to })} />
        </div>
        <Checkbox
          checked={c.all}
          onChange={(all) => setC({ ...c, all })}
          label="Hear every piece again"
          hint="Even those nothing changed for — after a doubt on the whole transcript."
        />
        <VideoEstimate docId={docId} video={video.n} />
      </div>
    </Modal>
  );
}
