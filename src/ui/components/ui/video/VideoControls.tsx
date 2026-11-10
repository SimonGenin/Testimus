import * as stylex from "@stylexjs/stylex";
import { space } from "../../../styles/tokens.stylex.ts";
import { Button } from "../Button.tsx";

const styles = stylex.create({
  row: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: space.snug },
  grow: { flex: 1 },
});

export type VideoControlsProps = {
  /** md: words on Loop, Back to the excerpt and Subtitles · sm: their icons alone */
  size: "md" | "sm";
  playing: boolean;
  onToggle: () => void;
  /** −5 s and +5 s */
  onSkip: (seconds: number) => void;
  /** the speed now (0.5, 1, 1.5); the button goes to the next one */
  rate: number;
  onRate: () => void;
  loop: boolean;
  onLoop: () => void;
  /** given while the playhead is away from the cited range, or the loop off: the way back */
  onBack?: () => void;
  /** given with subtitle tracks: the one shown (its name when there are several), none when off */
  subtitles?: { on: boolean; track?: string };
  onSubtitles: () => void;
  onFullScreen: () => void;
};

// ponytail: the player's row of controls, all kit buttons; each also has its key on the player (Space or K, ← →, L),
// said in the tooltip where the button is an icon alone
export function VideoControls({
  size,
  playing,
  onToggle,
  onSkip,
  rate,
  onRate,
  loop,
  onLoop,
  onBack,
  subtitles,
  onSubtitles,
  onFullScreen,
}: VideoControlsProps) {
  const sm = size === "sm";
  return (
    <div {...stylex.props(styles.row)}>
      <Button
        variant="primary"
        size={size}
        iconOnly
        icon={playing ? "pause" : "play"}
        label={playing ? "Pause" : "Play"}
        shortcut="Space"
        onClick={onToggle}
      />
      <Button size={size} label="− 5 s" onClick={() => onSkip(-5)} />
      <Button size={size} label="+ 5 s" onClick={() => onSkip(5)} />
      <Button size={size} icon={sm ? undefined : "clock"} label={`× ${rate}`} onClick={onRate} />
      <Button size={size} iconOnly={sm} icon="repeat" label="Loop" shortcut="L" pressed={loop} onClick={onLoop} />
      {onBack && <Button size={size} iconOnly={sm} icon="undo" label="Back to the excerpt" onClick={onBack} />}
      <span {...stylex.props(styles.grow)} />
      {subtitles && (
        <Button
          size={size}
          iconOnly={sm}
          icon="captions"
          label={subtitles.track ? `Subtitles · ${subtitles.track}` : "Subtitles"}
          pressed={subtitles.on}
          onClick={onSubtitles}
        />
      )}
      <Button size={size} iconOnly icon="expand" label="Full screen" onClick={onFullScreen} />
    </div>
  );
}
