import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Checkbox } from "../../components/ui/Checkbox.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import { clock, type VideoShown } from "../../lib/media.ts";
import { space } from "../../styles/tokens.stylex.ts";
import { type Heard, HeardFields } from "./HeardFields.tsx";
import { VideoEstimate } from "./VideoEstimate.tsx";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s5 },
});

export type VideoChoices = Heard & {
  /** hear every piece again, even those nothing changed for */
  all: boolean;
};

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
  const [c, setC] = useState<VideoChoices>({
    spoken: video.spoken ?? [],
    track: video.track ?? null,
    from: video.range ? clock(video.range.from) : "",
    to: video.range ? clock(video.range.to) : "",
    all: false,
  });
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={video.sound ? "Hear the recording again" : "Hear the video again"}
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
        <HeardFields
          value={c}
          tracks={video.tracks}
          duration={video.duration}
          sound={video.sound}
          onChange={(heard) => setC({ ...c, ...heard })}
        />
        <Checkbox
          checked={c.all}
          onChange={(all) => setC({ ...c, all })}
          label="Hear every piece again"
          hint="Even those nothing changed for — after a doubt on the whole transcript."
        />
        <VideoEstimate docId={docId} video={video.n} sound={video.sound} />
      </div>
    </Modal>
  );
}
