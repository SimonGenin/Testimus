import * as stylex from "@stylexjs/stylex";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { type } from "../../components/ui/type.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  shot: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0, width: "10.5rem", maxWidth: "100%" },
  fill: { width: "auto" },
  frame: { position: "relative", height: "6.25rem", overflow: "hidden", display: "flex" },
  img: { width: "100%", height: "100%", objectFit: "cover", objectPosition: "top left", display: "block" },
  tag: { position: "absolute", insetInlineStart: space.s1, insetBlockEnd: space.s1 },
  cap: { display: "flex", alignItems: "center", gap: space.s1, minWidth: 0, color: color.textMuted },
  name: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

// ponytail: a screenshot of a test run — its picture opens the viewer, its name says which, × takes it off
export function RunShot({
  file,
  url,
  step,
  fill = false,
  onOpen,
  onRemove,
}: {
  file: string;
  url: string;
  /** the step it shows, as a tag on the picture (the test's gallery) */
  step?: number;
  /** takes the width of its cell (a grid) */
  fill?: boolean;
  onOpen: () => void;
  onRemove?: () => void;
}) {
  return (
    <figure aria-label={`Screenshot ${file}`} {...stylex.props(styles.shot, fill && styles.fill)}>
      <Card padded={false} onOpen={onOpen} label={`Open ${file}`}>
        <span {...stylex.props(styles.frame)}>
          <img src={url} alt="" {...stylex.props(styles.img)} />
          {step !== undefined && (
            <span {...stylex.props(styles.tag)}>
              <Badge label={`Step ${step}`} size="sm" />
            </span>
          )}
        </span>
      </Card>
      <figcaption {...stylex.props(type.caption, type.mono, styles.cap)}>
        <span title={file} {...stylex.props(styles.name)}>
          {file}
        </span>
        {onRemove && (
          <Button variant="quiet" size="xs" icon="close" iconOnly label={`Remove ${file}`} onClick={onRemove} />
        )}
      </figcaption>
    </figure>
  );
}
