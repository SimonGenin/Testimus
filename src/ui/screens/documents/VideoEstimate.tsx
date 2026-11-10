import { Banner } from "../../components/ui/Banner.tsx";
import { Facts } from "../../components/ui/Facts.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { useRead } from "../../lib/data/query.ts";
import { clock } from "../../lib/media.ts";

export const minutes = (seconds: number) =>
  seconds < 90
    ? "about a minute"
    : seconds < 5400
      ? `about ${Math.round(seconds / 60)} min`
      : `about ${(seconds / 3600).toFixed(1)} h`;

const size = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;

const gb = (mb: number) => (mb / 1024).toFixed(1).replace(/\.0$/, "");

// ponytail: what a video will cost on this PC, said before it is heard — its length and weight, the time to hear it
// (measured here when a video was heard before, else a guess), Claude's share, the room it takes against the cap the
// team set for the project's videos, and a word when it is very long. A recording of sound alone has no picture to
// look through
export function VideoEstimate({
  docId,
  video,
  sound = false,
}: {
  docId: string;
  video: number;
  /** a recording of sound alone */
  sound?: boolean;
}) {
  const read = useRead("media.estimate", { doc: docId, video });
  const e = read.data;
  if (!e) return read.isError ? null : <Loading read="media.estimate" />;
  const what = sound ? "recording" : "video";
  const without = sound ? "no transcript" : "its pictures, no transcript";
  const look = e.framesSeconds > 0 ? `, ${minutes(e.framesSeconds)} to look through it` : "";
  return (
    <>
      <Facts
        size="sm"
        label={`What the ${what} will take`}
        items={[
          { label: "Length · weight", value: `${clock(e.duration)}${e.bytes ? ` · ${size(e.bytes)}` : ""}` },
          e.audio &&
            !e.missing && {
              label: "On this PC",
              value: `${minutes(e.speechSeconds)} to hear it${e.device === "gpu" ? " on the graphics card" : ""}${look} · ${e.measured ? "measured here" : "estimated"}`,
            },
          !!e.withCardSeconds && {
            label: "With the graphics card",
            value: `${minutes(e.withCardSeconds)} to hear it, once the engine's NVIDIA build is installed (Settings › Models › Transcription)`,
          },
          e.claude.runs > 0 && {
            label: "Claude's share",
            value: `About ${e.claude.runs} run${e.claude.runs > 1 ? "s" : ""}${e.claude.images > 0 ? `, ${e.claude.images} pictures` : ""}`,
          },
          e.disk.freeMB !== null && {
            label: "Room",
            value: `About ${size(e.disk.needMB * 1e6)} with what is drawn from it · ${size(e.disk.freeMB * 1e6)} free`,
          },
          e.disk.capMB !== undefined && {
            label: "The team's cap",
            value: `${gb(e.disk.usedMB)} of ${gb(e.disk.capMB)} GB used by the project's videos`,
          },
        ]}
      />
      {e.missing && (
        <Banner tone="warning" compact>
          {e.missing === "engine"
            ? `The transcription engine is not on this PC: the ${what} will have ${without}. Install it in Settings › Models › Transcription.`
            : `No transcription model is on this PC: the ${what} will have ${without}. Install one in Settings › Models › Transcription.`}
        </Banner>
      )}
      {e.long && (
        <Banner tone="info" compact>
          Longer than two hours: you can transcribe a part of it only (From, To).
        </Banner>
      )}
      {e.disk.freeMB !== null && e.disk.freeMB < e.disk.needMB && (
        <Banner tone="danger" compact>
          Not enough room on the project's drive for this {what} and what is drawn from it.
        </Banner>
      )}
      {e.disk.over && e.disk.capMB !== undefined && (
        <Banner tone="warning" compact title="The project's videos pass the room they may take">
          {gb(e.disk.usedMB)} of {gb(e.disk.capMB)} GB are used: a video added now is refused. Raise the cap in Settings
          › Videos, or remove a video.
        </Banner>
      )}
    </>
  );
}
