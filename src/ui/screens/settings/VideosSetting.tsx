import * as stylex from "@stylexjs/stylex";
import type { CommandInput } from "../../../core/commands/index.ts";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { ChipField } from "../../components/ui/ChipField.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { GlossaryCard } from "./GlossaryCard.tsx";
import { type ProjectJson, useSetProject } from "./project.ts";
import { Grid, Hint, Stack } from "./Section.tsx";
import { VideoNumber } from "./VideoNumber.tsx";

const styles = stylex.create({
  block: { display: "flex", flexDirection: "column", gap: space.s5, minWidth: 0 },
  spoken: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  heard: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    columnGap: space.s3,
    rowGap: space.s2,
    color: color.textMuted,
  },
});

type Video = NonNullable<CommandInput<"project.set">["video"]>;
type Density = NonNullable<Video["density"]>;

const DENSITY: { value: Density; label: string }[] = [
  { value: "sober", label: "Sober" },
  { value: "normal", label: "Normal" },
  { value: "detailed", label: "Detailed" },
];

// ponytail: a language heard for less than this is a noise taken for speech, not a language to expect
const HEARD_S = 20;

const gb = (mb: number) => (mb / 1024).toFixed(mb < 10240 ? 1 : 0);
const spent = (seconds: number) => (seconds >= 60 ? `${Math.round(seconds / 60)} min` : `${Math.round(seconds)} s`);

// ponytail: project.json video — how the project's videos are heard and looked through (the languages expected, the
// translation, how many key frames), how a cited range is played, the room they may take, and the words given to the
// engine; each choice is saved as it is made and holds for the videos heard from then on
export function VideosSetting({ video }: { video: ProjectJson["video"] }) {
  const setProject = useSetProject();
  const glossary = useRead("media.glossary", {});
  const used = useRead("media.disk", {}).data?.usedMB;
  const g = glossary.data;
  const spoken = video?.spoken ?? [];
  const nameOf = (code: string) => g?.languages.find((l) => l.code === code)?.name ?? code;
  const heard = (g?.heard ?? []).filter((h) => h.seconds >= HEARD_S);
  const expected = heard.map((h) => h.language);
  const differs = expected.length !== spoken.length || expected.some((code) => !spoken.includes(code));
  const set = (patch: Video) => void setProject({ video: patch }, "the videos' settings");
  return (
    <div {...stylex.props(styles.block)}>
      <Card title="Videos">
        <Stack loose>
          <div {...stylex.props(styles.spoken)}>
            <Field
              label="Languages spoken in the videos"
              hint="Each passage is heard in the one of them it is said in. None: every passage in the language detected. One: every passage in it — about twice as fast on a PC without a graphics card."
            >
              <ChipField
                label="Languages spoken in the videos"
                placeholder="Add a language…"
                values={spoken}
                choices={(g?.languages ?? []).map((l) => ({ value: l.code, label: l.name }))}
                onChange={(codes) => set({ spoken: codes })}
              />
            </Field>
            {heard.length > 0 && differs && (
              <div {...stylex.props(type.small, styles.heard)}>
                <span>
                  Heard so far in this project:{" "}
                  {heard.map((h) => `${nameOf(h.language)} ${spent(h.seconds)}`).join(" · ")}
                </span>
                <Button size="sm" label="Expect these" onClick={() => set({ spoken: expected })} />
              </div>
            )}
          </div>
          <Switch
            on={video?.translate !== false}
            label="Translate what is said in another language"
            hint="Claude writes the project's language beside the line; the line as it was said stays the text a test may quote."
            onChange={(translate) => set({ translate })}
          />
          <Field label="Key frames" hint="About 40 frames for half an hour of video at Normal, 150 at most.">
            <div>
              <Segmented
                label="Key frames"
                value={video?.density ?? "normal"}
                options={DENSITY}
                onChange={(density) => set({ density })}
              />
            </div>
          </Field>
          <Grid>
            <VideoNumber
              field="margin"
              label="Seconds played around a cited range"
              hint="A source opened on a video plays in a loop, this long before and after what it cites. From 0 to 30."
              saved={video?.margin}
              empty={4}
              max={30}
            />
            <VideoNumber
              field="diskCapGB"
              label="Room for the videos (GB)"
              placeholder="No cap"
              hint={`The originals, the lighter copies, the sound and the frames together. A video that would pass it is refused when added; empty: no cap.${used === undefined ? "" : ` The project's videos take ${gb(used)} GB today.`}`}
              saved={video?.diskCapGB}
              empty={0}
            />
          </Grid>
        </Stack>
      </Card>
      <GlossaryCard glossary={g} failed={glossary.error?.message} />
      <Hint>
        These apply to the videos heard from now on; a video already heard is heard again from Documents › Video › «
        Hear again… ».
      </Hint>
    </div>
  );
}
