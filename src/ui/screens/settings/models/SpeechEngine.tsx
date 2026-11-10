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

const BACKEND = { cuda: "NVIDIA (CUDA 12.4)", cpu: "processor" } as const;

// ponytail: whisper.cpp on this PC — its build and what it runs on, or the download that fits this PC's graphics
// card; the processor build on a PC with an NVIDIA card is offered the card's build, far faster
export function SpeechEngine({
  engine,
  op,
  busy,
  onInstall,
}: {
  engine: Speech["engine"];
  op: Op | null;
  busy: boolean;
  onInstall: (backend?: "cuda" | "cpu") => void;
}) {
  const upgrade = engine.installed && engine.backend === "cpu" && engine.card;
  const cuda = engine.advised === "cuda" ? ` · ${size(engine.downloadMB)}` : "";
  return (
    <Card
      fill
      title="Engine · whisper.cpp"
      actions={<Badge {...(engine.installed ? INSTALLED.all : INSTALLED.none)} size="sm" />}
    >
      <Stack>
        {engine.installed ? (
          <Facts
            size="sm"
            label="Engine"
            items={[
              { label: "Build", value: `${engine.build} · ${engine.backend ? BACKEND[engine.backend] : ""}` },
              { label: "Voice detector", value: `${engine.detector} — silence and noise are never transcribed` },
            ]}
          />
        ) : (
          <Hint>
            Hears what is said in a video. Without it a video keeps its pictures and has no transcript.{" "}
            {engine.advised === "cuda"
              ? "This PC gets the NVIDIA build, for its graphics card."
              : "This PC gets the processor build."}
          </Hint>
        )}
        {op ? (
          <OpLine op={op} />
        ) : !engine.installed ? (
          <div {...stylex.props(styles.act)}>
            <Button
              variant="primary"
              size="sm"
              icon="download"
              label={`Install · ${size(engine.downloadMB)}`}
              disabled={busy}
              onClick={() => onInstall()}
            />
            <Hint>Build {engine.build}, checked by its SHA-256. No admin rights.</Hint>
          </div>
        ) : (
          upgrade && (
            <div {...stylex.props(styles.act)}>
              <Button
                size="sm"
                icon="download"
                label={`Install the NVIDIA build${cuda}`}
                disabled={busy}
                onClick={() => onInstall("cuda")}
              />
              <Hint>This PC has an NVIDIA card: with its build a video is heard far faster than on the processor.</Hint>
            </div>
          )
        )}
      </Stack>
    </Card>
  );
}
