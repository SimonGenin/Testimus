import * as stylex from "@stylexjs/stylex";
import { type DragEvent, useState } from "react";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Icon } from "../../components/ui/Icon.tsx";
import { type } from "../../components/ui/type.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  zone: { minWidth: 0 },
  compact: { width: "10.5rem", maxWidth: "100%" },
  body: { display: "flex", alignItems: "center", gap: space.s3, color: color.textMuted },
  column: { flexDirection: "column", justifyContent: "center", textAlign: "center", gap: space.s1, minHeight: "5rem" },
  words: { display: "flex", flexDirection: "column", minWidth: 0 },
  title: { color: color.text },
});

export const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
export const picturesOf = (list: FileList | null | undefined) =>
  [...(list ?? [])].filter((f) => f.type.startsWith("image/"));

// ponytail: where screenshots are dropped — a dashed place that lights up under a file, with Browse… for those who
// prefer a dialog; pasting (Ctrl+V) is the screen's, not this box's
export function RunDrop({
  label,
  hint,
  compact = false,
  onFiles,
}: {
  label: string;
  hint: string;
  compact?: boolean;
  onFiles: (files: File[]) => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      data-testid="run-drop"
      data-over={over || undefined}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        const files = picturesOf(e.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
      {...stylex.props(styles.zone, compact && styles.compact)}
    >
      <Card dashed selected={over} density="compact">
        <div {...stylex.props(type.small, styles.body, compact && styles.column)}>
          <Icon name="upload" />
          <span {...stylex.props(styles.words)}>
            <span {...stylex.props(type.compact, type.medium, styles.title)}>{label}</span>
            <span>{hint}</span>
          </span>
          <Button size="sm" variant="quiet" label="Browse…" pick={{ accept: "image/*", multiple: true, onFiles }} />
        </div>
      </Card>
    </div>
  );
}
