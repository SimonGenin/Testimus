import * as stylex from "@stylexjs/stylex";
import type { DocJson } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Menu, type MenuEntry } from "../../components/ui/Menu.tsx";
import { Tabs } from "../../components/ui/Tabs.tsx";
import { type } from "../../components/ui/type.ts";
import { project } from "../../lib/data/client.ts";
import { baseName, desktop, pathJoin, pickFiles, reveal } from "../../lib/desktop.ts";
import { plural } from "../../lib/format.ts";
import {
  clock,
  type Described,
  IMAGE_EXTENSIONS,
  isMedia,
  isSound,
  MEDIA_ACCEPT,
  SOUND_EXTENSIONS,
  typeLabel,
  VIDEO_EXTENSIONS,
} from "../../lib/media.ts";
import { type Picked, pickedOfFiles, pickedOfPaths } from "../../lib/uploads.ts";
import { border, color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  head: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s4,
    paddingBlock: space.s2,
    paddingInline: space.s6,
    minHeight: `calc(${space.s11} - ${space.s2})`,
    borderBottomStyle: "solid",
    borderBottomWidth: border.width,
    borderBottomColor: color.border,
    backgroundColor: color.surface,
  },
  titles: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: space.s1 },
  titleLine: { display: "flex", alignItems: "baseline", gap: space.s4, minWidth: 0, flexWrap: "wrap" },
  title: { margin: 0, color: color.text },
  code: { color: color.textMuted },
  facts: { color: color.textMuted },
  acts: {
    display: "flex",
    alignItems: "center",
    gap: space.s3,
    alignSelf: "stretch",
    marginBlock: `calc(-1 * ${space.s2})`,
  },
});

export type View = "text" | "figures" | "images" | "video";

// ponytail: what an images or video document holds, in one line (« 46 images · taken 2026-11-05 · read by Claude »)
function mediaFacts(doc: DocJson): string {
  const files = doc.source.files ?? [];
  const images = files.filter((f) => f.kind === "image");
  const videos = files.filter((f) => f.kind === "video");
  const taken = images
    .map((f) => f.takenAt)
    .filter((t): t is string => !!t)
    .sort()[0];
  const read = files.length > 0 && files.every((f) => f.state === "analysed");
  return [
    images.length ? plural(images.length, "image") : "",
    ...videos.map((v) => `${v.name}${v.duration ? ` · ${clock(v.duration)}` : ""}`),
    taken ? `taken ${taken.slice(0, 10)}` : "",
    read ? "read by Claude" : doc.converted?.at ? "" : "not prepared yet",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function DocHead({
  doc,
  sections,
  figures,
  running,
  view,
  onView,
  sectionsButton,
  sectionsOpen,
  onSections,
  onConvertAgain,
  onDelete,
  onAddMedia,
  onReference,
  onLeftOut,
}: {
  doc: Described;
  sections: number;
  figures: number;
  running: boolean;
  view: View;
  onView: (v: View) => void;
  /** the contents do not fit beside the text: a button opens them in a drawer */
  sectionsButton: boolean;
  sectionsOpen: boolean;
  onSections: () => void;
  onConvertAgain: () => void;
  onDelete: () => void;
  /** an images or video document: add images or videos to it (picked in the browser, or paths from the desktop app) */
  onAddMedia?: (picked: Picked[]) => void;
  /** an images or video document: mark it as the reference, or back to observed */
  onReference?: (reference: boolean) => void;
  /** an images or video document: keep it from Claude (no run reads, searches or describes it), or give it back */
  onLeftOut?: (kept: boolean) => void;
}) {
  const from = typeLabel(doc);
  const media = isMedia(doc.type);
  const files = doc.source.files ?? [];
  const videos = files.filter((f) => f.kind === "video");
  const converted = !!doc.converted?.at;
  const reading = !running && converted;
  const dir = project();
  const before: MenuEntry[] = [
    ...(converted ? [{ label: "Convert again…", icon: "refresh" as const, onSelect: onConvertAgain }] : []),
    ...(desktop() && dir
      ? [
          {
            label: "Show in Explorer",
            icon: "folder-open" as const,
            onSelect: () => void reveal(pathJoin(dir, "docs", doc.id)),
          },
        ]
      : []),
    {
      label: "Copy the document id",
      icon: "copy",
      onSelect: () => void navigator.clipboard?.writeText(doc.id).catch(() => {}),
    },
  ];
  const entries: MenuEntry[] = [
    ...before,
    "separator",
    { label: "Delete this document…", icon: "trash", danger: true, onSelect: onDelete },
  ];
  return (
    <header {...stylex.props(styles.head)}>
      <div {...stylex.props(styles.titles)}>
        <div {...stylex.props(styles.titleLine)}>
          <h2 {...stylex.props(type.title, styles.title)}>{doc.title}</h2>
          <span {...stylex.props(type.code, styles.code)}>
            <span>{doc.code}</span>
            {doc.version && (
              <>
                {" · "}
                <span>version {doc.version}</span>
              </>
            )}
            {doc.date && (
              <>
                {" · "}
                <span>{doc.date}</span>
              </>
            )}
          </span>
          {media && doc.private && <Badge size="sm" tone="warning" icon="lock" label="Never given to Claude" />}
        </div>
        <span {...stylex.props(type.small, styles.facts)}>
          {media
            ? running
              ? `Preparing · ${mediaFacts(doc)}`
              : mediaFacts(doc)
            : running
              ? `Converting from ${from} · ${baseName(doc.source.name || doc.source.file)}`
              : converted
                ? `Converted from ${from} · ${plural(sections, "section")} · ${plural(figures, "figure")}`
                : `${from} file, not converted · ${baseName(doc.source.name || doc.source.file)}`}
        </span>
      </div>
      <div {...stylex.props(styles.acts)}>
        {media && doc.type !== "video" && onAddMedia && !running && (
          <Button
            size="sm"
            icon="plus"
            label="Add images…"
            pick={
              desktop()
                ? undefined
                : { accept: MEDIA_ACCEPT, multiple: true, onFiles: (f) => onAddMedia(pickedOfFiles(f)) }
            }
            onClick={
              desktop()
                ? () =>
                    void pickFiles(
                      "Add images or videos",
                      [
                        {
                          name: "Images, videos and sound",
                          extensions: [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...SOUND_EXTENSIONS],
                        },
                      ],
                      true,
                    ).then((p) => p.length && onAddMedia(pickedOfPaths(p)))
                : undefined
            }
          />
        )}
        {media && onReference && !running && (
          <Button
            size="sm"
            icon={doc.reference ? "eye" : "validated"}
            label={doc.reference ? "Observed, not the reference" : "Reference, not observed"}
            onClick={() => onReference(!doc.reference)}
          />
        )}
        {media && onLeftOut && !running && (
          <Button
            size="sm"
            icon={doc.private ? "claude" : "lock"}
            label={doc.private ? "Given to Claude" : "Never to Claude"}
            onClick={() => onLeftOut(!doc.private)}
          />
        )}
        {reading && (
          <Tabs
            label="Document views"
            size="sm"
            inline
            value={view}
            onChange={onView}
            tabs={
              media
                ? [
                    ...(files.some((f) => f.kind === "image")
                      ? [
                          {
                            value: "images" as const,
                            label: "Images",
                            icon: "image" as const,
                            count: files.filter((f) => f.kind === "image").length,
                          },
                        ]
                      : []),
                    ...(videos.length
                      ? [
                          {
                            value: "video" as const,
                            label: videos.every((f) => isSound(f.name)) ? "Sound" : "Video",
                            icon: "play" as const,
                          },
                        ]
                      : []),
                    { value: "text", label: "Text", icon: "text" },
                  ]
                : [
                    { value: "text", label: "Text", icon: "text" },
                    { value: "figures", label: "Figures", icon: "image", count: figures },
                  ]
            }
          />
        )}
        {reading && sectionsButton && view === "text" && (sections > 1 || !media) && (
          <Button size="sm" variant="quiet" icon="list" label="Sections" expanded={sectionsOpen} onClick={onSections} />
        )}
        {!running && (
          <Menu
            align="end"
            label="More actions for this document"
            entries={entries}
            trigger={<Button variant="quiet" iconOnly icon="more" label="More actions for this document" />}
          />
        )}
      </div>
    </header>
  );
}
