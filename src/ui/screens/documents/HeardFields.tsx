import * as stylex from "@stylexjs/stylex";
import { ChipField } from "../../components/ui/ChipField.tsx";
import { Select } from "../../components/ui/Select.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { clock } from "../../lib/media.ts";
import { space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  fields: { display: "flex", flexDirection: "column", gap: space.s5, minWidth: 0 },
  part: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: space.s4 },
});

export type Heard = {
  spoken: string[];
  /** the one sound track heard; null: all of them, mixed */
  track: number | null;
  from: string;
  to: string;
};

export type SoundTrack = { language?: string; title?: string };

// ponytail: the choices as media.set takes them. A part is always sent whole — a start left empty is the video's, an
// end left empty its last second — because media.set keeps the bound it is not given: clearing one field alone would
// leave the old one in place
export function heardInput(c: Heard, duration?: number) {
  const from = c.from.trim();
  const to = c.to.trim();
  const end = to || (duration ? String(Math.ceil(duration)) : "");
  return {
    spoken: c.spoken,
    ...(c.track === null ? { allTracks: true } : { track: c.track }),
    ...(from || to ? { from: from || "0", ...(end ? { to: end } : {}) } : { whole: true }),
  };
}

// ponytail: what is heard of a video, chosen before its first conversion (the document not converted yet) and again
// from « Hear again… » — the languages spoken in it (none: the project's), one sound track or all of them mixed when
// the file has several, a part of it or the whole. `onSettle` is told when a choice is complete: a language or a
// track picked, a moment typed and left
export function HeardFields({
  value,
  tracks,
  duration,
  sound = false,
  onChange,
  onSettle,
}: {
  value: Heard;
  tracks: SoundTrack[];
  /** the video's length, seconds (0 while unknown) */
  duration: number;
  /** a recording of sound alone: the words say so */
  sound?: boolean;
  onChange: (next: Heard) => void;
  onSettle?: (next: Heard) => void;
}) {
  const languages = useRead("media.glossary", {}).data?.languages ?? [];
  const expected = useApp().info?.project?.video?.spoken ?? [];
  const what = sound ? "recording" : "video";
  const settle = (next: Heard) => {
    onChange(next);
    onSettle?.(next);
  };
  const options = tracks.map((t, i) => ({
    value: String(i),
    label: [`Track ${i + 1}`, t.title, t.language].filter(Boolean).join(" · "),
  }));
  const leave = { onBlur: () => onSettle?.(value) };
  return (
    <div {...stylex.props(styles.fields)}>
      <ChipField
        label={`Languages spoken in this ${what}`}
        showLabel
        values={value.spoken}
        choices={languages.map((l) => ({ value: l.code, label: l.name }))}
        placeholder={
          expected.length
            ? `The project's: ${expected.map((code) => languages.find((l) => l.code === code)?.name ?? code).join(", ")}`
            : "The project's languages"
        }
        onChange={(spoken) => settle({ ...value, spoken })}
      />
      {options.length > 1 && (
        <Select
          label="Sound"
          showLabel
          block
          value={value.track === null ? "all" : String(value.track)}
          options={[{ value: "all", label: `All ${options.length} tracks, mixed` }, ...options]}
          onChange={(v) => settle({ ...value, track: v === "all" ? null : Number(v) })}
          hint="A screen recording keeps the microphone and the PC's sound on two tracks."
        />
      )}
      <div {...stylex.props(styles.part)}>
        <Text
          label="From"
          placeholder="00:00"
          value={value.from}
          onChange={(from) => onChange({ ...value, from })}
          hint={`Leave both empty for the whole ${what}.`}
          {...leave}
        />
        <Text
          label="To"
          placeholder={duration ? clock(duration) : "mm:ss"}
          value={value.to}
          onChange={(to) => onChange({ ...value, to })}
          {...leave}
        />
      </div>
    </div>
  );
}
