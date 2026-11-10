import { useState } from "react";
import { Video, type VideoRange } from "../../../components/ui/Video.tsx";
import { fileUrl } from "../../../lib/data/client.ts";
import { Cell, type KitSection, States } from "../kit.tsx";

const DOC = "docs/Manoeuvre_d_un_sectionneur_au_PCC";
const SAMPLE = `${DOC}/files/manoeuvre.mp4`;
const LENGTH = 160;
const CITED = { from: 62, to: 74 };
const CHAPTERS = [
  { at: 0, title: "Ouverture du poste et connexion" },
  { at: 40, title: "Sélection du sectionneur S12 sur le synoptique" },
  { at: 80, title: "Menu contextuel et fenêtre Propriétés" },
  { at: 120, title: "Refus de manœuvre, message d'alarme" },
];
const MARKS = [
  { at: 20, label: "frame:00:20 Ouverture du poste et connexion" },
  { at: 60, label: "frame:01:00 Sélection du sectionneur S12 sur le synoptique" },
  { at: 100, label: "frame:01:40 Menu contextuel et fenêtre Propriétés" },
  { at: 140, label: "frame:02:20 Refus de manœuvre, message d'alarme" },
];
const said = () => ({ src: fileUrl(`${DOC}/video/1/said.vtt`), label: "original", lang: "fr" });
const translated = () => ({ src: fileUrl(`${DOC}/video/1/translated.vtt`), label: "translated", lang: "fr" });

function Adjusted() {
  const [range, setRange] = useState<VideoRange>(CITED);
  return (
    <Video
      size="sm"
      src={fileUrl(SAMPLE)}
      label="Video manoeuvre.mp4 in a side tab"
      duration={LENGTH}
      range={range}
      onRange={setRange}
      chapters={CHAPTERS}
      subtitles={[said(), translated()]}
    />
  );
}

export const section: KitSection = {
  name: "Video",
  family: "Collections",
  file: "Video.tsx",
  summary:
    "A video of a document, in a player made to check a source: the range a source cites is played in a loop with a margin around it and drawn on the timeline; the loop is left by looking elsewhere and found again with « Back to the excerpt ». A 16:9 frame on the inverse surface, rounded 12 px, the timeline and the controls under it.",
  note: "New with videos as documents (2026-11-08): no kit component drew a video. Its own controls since videos are sources (2026-11-10): the browser's player can neither loop on a range nor show where a source starts. One frame, one player; the transcript beside it is the screen's, built from Text and List.",
  guidelines: [
    {
      head: "Anatomy",
      text: "The frame (`surface-inverse`, `radius.r3`, 16:9; a click plays or pauses; « Loop · 00:58 – 01:18 » on it while it loops) · the timeline: the whole video in grey, what the loop plays in a pale accent, the cited range in the accent, chapters as ticks, key frames as dots, the playhead · the clock (« 01:06 / 02:40 ») and the legend of the two tones · the controls: Play, − 5 s, + 5 s, speed, Loop, Back to the excerpt, Subtitles, Full screen.",
    },
    {
      head: "Options",
      text: '`range` is what a source cites: played in a loop with `margin` seconds around it (4; shorter at the video\'s two ends), from its start, never by itself on arrival · `onRange` makes its two bounds handles (drag, or ← → a second at a time), told when one is let go · `duration` draws the timeline before the file says its length · `chapters` and `marks` are ticks and dots, their words as tooltips · `subtitles` are WebVTT tracks: one is on or off, two go off → first → second · `start` opens at a moment (a source `t:04:30`) · `poster` before it plays · `onTime` follows the playhead (the transcript marks the line said) · `ref`: `seek(seconds)`, `play()`, `pause()`, `loop(range)` — a transcript line to listen to · `onUnplayable` when the browser cannot read the file · `size="sm"` in a side tab: Loop, Back to the excerpt and Subtitles as icons alone.',
    },
    {
      head: "Keys",
      text: "While the focus is in the player: `Space` or `K` plays and pauses · `←` `→` move 5 s · `,` `.` one frame when paused · `L` the loop · on the timeline `Home` and `End` · on a bound of the cited range `←` `→` move it a second.",
    },
    {
      head: "Rules",
      items: [
        "A click on the timeline outside what the loop plays, or a moment asked from outside it, stops the loop: the user is looking elsewhere. The cited range stays drawn; « Back to the excerpt » goes back to its start, loops and plays.",
        "The loop returns on the frame, not on the quarter second: it follows every frame shown where the browser tells them.",
        "Its timed transcript stands beside it as its text: a line is clickable and goes to its moment.",
        "The file comes through `/files`, which answers byte ranges, so the player can seek without loading it all.",
        "An owner that keeps a moved range gives it back as `range`; « Save » and what it rewrites are the owner's.",
      ],
    },
  ],
  states: () => (
    <States>
      <Cell label="a project video (the fixture's under --mock)" wide column>
        <Video src={fileUrl(SAMPLE)} label="Video manoeuvre.mp4" />
      </Cell>
      <Cell label="start at 01:20" wide column>
        <Video src={fileUrl(SAMPLE)} label="Video manoeuvre.mp4 at 01:20" start={80} />
      </Cell>
      <Cell label="a cited range 01:02 → 01:14, with chapters, key frames and subtitles" wide column>
        <Video
          src={fileUrl(SAMPLE)}
          label="Video manoeuvre.mp4, a source"
          duration={LENGTH}
          range={CITED}
          chapters={CHAPTERS}
          marks={MARKS}
          subtitles={[said()]}
        />
      </Cell>
      <Cell label='size="sm" with onRange: the bounds are handles, two subtitle tracks' column>
        <Adjusted />
      </Cell>
    </States>
  ),
};
