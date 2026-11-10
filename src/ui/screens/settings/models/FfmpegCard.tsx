import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { Facts } from "../../../components/ui/Facts.tsx";
import { space } from "../../../styles/tokens.stylex.ts";
import { Hint, Stack } from "../Section.tsx";
import { INSTALLED, type Speech, size } from "./data.ts";
import { OpLine } from "./OpLine.tsx";
import type { Op } from "./ops.tsx";

const styles = stylex.create({
  act: { display: "flex", alignItems: "center", flexWrap: "wrap", columnGap: space.s3, rowGap: space.s2 },
});

// ponytail: ffmpeg on this PC — the program that reads a video's sound and frames, or its download
export function FfmpegCard({
  ffmpeg,
  op,
  busy,
  onInstall,
}: {
  ffmpeg: Speech["ffmpeg"];
  op: Op | null;
  busy: boolean;
  onInstall: () => void;
}) {
  return (
    <Card fill title="ffmpeg" actions={<Badge {...(ffmpeg.installed ? INSTALLED.all : INSTALLED.none)} size="sm" />}>
      <Stack>
        <Hint>Reads the videos: their sound, their frames. Without it a video is kept but not read.</Hint>
        {ffmpeg.installed && <Facts size="sm" label="ffmpeg" items={[{ label: "Build", value: ffmpeg.build }]} />}
        {op ? (
          <OpLine op={op} />
        ) : (
          !ffmpeg.installed && (
            <div {...stylex.props(styles.act)}>
              <Button
                variant="primary"
                size="sm"
                icon="download"
                label={`Install · ${size(ffmpeg.downloadMB)}`}
                disabled={busy}
                onClick={onInstall}
              />
              <Hint>Version {ffmpeg.build}, checked by its SHA-256. No admin rights.</Hint>
            </div>
          )
        )}
      </Stack>
    </Card>
  );
}
