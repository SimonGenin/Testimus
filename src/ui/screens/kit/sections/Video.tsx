import { Video } from "../../../components/ui/Video.tsx";
import { fileUrl } from "../../../lib/data/client.ts";
import { Cell, type KitSection, States } from "../kit.tsx";

const SAMPLE = "docs/Manoeuvre_d_un_sectionneur_au_PCC/files/manoeuvre.mp4";

export const section: KitSection = {
  name: "Video",
  family: "Collections",
  file: "Video.tsx",
  summary:
    "A video of a document: the browser's own player (controls, keyboard, full screen) in a 16:9 frame on the inverse surface, rounded 12 px. What plays it from outside — a transcript line, a chapter, a key frame — seeks it.",
  note: "New with videos as documents (2026-11-08): no kit component drew a video. One frame, one player; the transcript beside it is the screen's, built from Text and List.",
  guidelines: [
    {
      head: "Anatomy",
      text: "The frame (`surface-inverse`, `radius.r3`, 16:9) · the native `<video controls>` filling it (letterboxed) · the focus ring inside the frame.",
    },
    {
      head: "Options",
      text: "`start` opens at a moment (a source `t:04:30`) · `poster` before it plays · `onTime` follows the playhead (the transcript marks the line said) · `ref.seek(seconds)` goes to a moment.",
    },
    {
      head: "Rules",
      items: [
        "Its timed transcript stands beside it as its text: a line is clickable and goes to its moment.",
        "The file comes through `/files`, which answers byte ranges, so the player can seek without loading it all.",
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
    </States>
  ),
};
