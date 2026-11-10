import * as stylex from "@stylexjs/stylex";
import type { CommandInput } from "../../../core/commands/index.ts";
import { Button } from "../../components/ui/Button.tsx";
import { ChipField } from "../../components/ui/ChipField.tsx";
import { Field } from "../../components/ui/Field.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Segmented } from "../../components/ui/Segmented.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Switch } from "../../components/ui/Switch.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { GlossaryCard } from "./GlossaryCard.tsx";
import { useInfo, useSetProject } from "./project.ts";
import { Group, Hint, Row, Section } from "./Section.tsx";
import { VideoNumber } from "./VideoNumber.tsx";

const styles = stylex.create({
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

// ponytail: project.json video — how the project's videos are heard (the languages expected, the translation, the
// glossary), looked through (how many key frames) and played (the loop around a cited range), and the room they may
// take; each choice holds for the videos heard from then on. The engine and its models are this PC's (Models)
export function VideosSection() {
  const app = useApp();
  const info = useInfo();
  const video = info.data?.project.video;
  const loaded = !!info.data;
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
    <Section
      id="videos"
      title="Videos"
      intro="How this project's videos are heard, looked through and played back. A change holds for the videos heard from now on."
      actions={
        <Button size="sm" label="Engine and models on this PC" onClick={() => app.navigate("settings", "models")} />
      }
    >
      {!loaded ? (
        <>
          <Skeleton kind="block" />
          <Loading read="project.info" />
        </>
      ) : (
        <>
          <Group id="videos-hearing" title="Hearing">
            <Row>
              <Field
                aside
                label="Languages spoken"
                hint="Each passage is heard in the one it is said in. None: the language detected. One: about twice as fast on a PC without a graphics card."
              >
                <ChipField
                  label="Languages spoken in the videos"
                  placeholder="Add a language…"
                  values={spoken}
                  choices={(g?.languages ?? []).map((l) => ({ value: l.code, label: l.name }))}
                  onChange={(codes) => set({ spoken: codes })}
                />
                {heard.length > 0 && differs && (
                  <div {...stylex.props(type.small, styles.heard)}>
                    <span>
                      Heard so far in this project:{" "}
                      {heard.map((h) => `${nameOf(h.language)} ${spent(h.seconds)}`).join(" · ")}
                    </span>
                    <Button size="sm" label="Expect these" onClick={() => set({ spoken: expected })} />
                  </div>
                )}
              </Field>
            </Row>
            <Row>
              <Field aside label="Translation" hint="The line as it was said stays the text a test quotes.">
                <div>
                  <Switch
                    on={video?.translate !== false}
                    label="Translate what is said in another language"
                    onChange={(translate) => set({ translate })}
                  />
                </div>
              </Field>
            </Row>
          </Group>
          <GlossaryCard glossary={g} failed={glossary.error?.message} />
          <Group
            id="videos-frames"
            title="Key frames and playback"
            footer={
              <Hint>
                A video already heard keeps its transcript; Documents › the video › « Hear again… » hears it with these
                settings.
              </Hint>
            }
          >
            <Row>
              <Field
                aside
                label="Key frames"
                hint="How many settled screens are kept as pictures Claude can cite: about 40 for half an hour at Normal, 150 at most."
              >
                <div>
                  <Segmented
                    label="Key frames"
                    value={video?.density ?? "normal"}
                    options={DENSITY}
                    onChange={(density) => set({ density })}
                  />
                </div>
              </Field>
            </Row>
            <Row>
              <VideoNumber
                field="margin"
                label="Seconds played around a cited range"
                hint="A video source plays in a loop, this long before and after what it cites. From 0 to 30."
                saved={video?.margin}
                empty={4}
                max={30}
              />
            </Row>
            <Row>
              <VideoNumber
                field="diskCapGB"
                label="Room for the videos (GB)"
                placeholder="No cap"
                hint={`Originals, lighter copies, sound and frames together. A video that would pass it is refused when added; empty: no cap.${used === undefined ? "" : ` The project's videos take ${gb(used)} GB today.`}`}
                saved={video?.diskCapGB}
                empty={0}
              />
            </Row>
          </Group>
        </>
      )}
    </Section>
  );
}
