import * as stylex from "@stylexjs/stylex";
import type { DocJson } from "../../../core/types.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Menu, type MenuEntry } from "../../components/ui/Menu.tsx";
import { Tabs } from "../../components/ui/Tabs.tsx";
import { type } from "../../components/ui/type.ts";
import { project } from "../../lib/data/client.ts";
import { baseName, desktop, pathJoin, reveal } from "../../lib/desktop.ts";
import { plural } from "../../lib/format.ts";
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
  dotWrap: { position: "relative", display: "inline-flex" },
  dot: { position: "absolute", top: space.s1, right: space.s1, display: "inline-flex", pointerEvents: "none" },
});

export type View = "text" | "figures";

export function DocHead({
  doc,
  sections,
  figures,
  running,
  view,
  onView,
  listOpen,
  onShowList,
  sectionsButton,
  detailsButton,
  drawer,
  onDrawer,
  onConvertAgain,
  onDelete,
}: {
  doc: DocJson;
  sections: number;
  figures: number;
  running: boolean;
  view: View;
  onView: (v: View) => void;
  listOpen: boolean;
  onShowList?: () => void;
  sectionsButton: boolean;
  detailsButton: boolean;
  drawer: "sections" | "details" | null;
  onDrawer: (which: "sections" | "details") => void;
  onConvertAgain: () => void;
  onDelete: () => void;
}) {
  const from = doc.source.file?.endsWith(".pdf") ? "PDF" : "Word";
  const converted = !!doc.converted?.at;
  const reading = !running && converted;
  const warned = !running && (doc.converted?.warnings ?? []).length > 0;
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
      {onShowList && (
        <Button
          variant="quiet"
          iconOnly
          icon="panel-left"
          label="Show the document list"
          expanded={listOpen}
          onClick={onShowList}
        />
      )}
      <div {...stylex.props(styles.titles)}>
        <div {...stylex.props(styles.titleLine)}>
          <h2 {...stylex.props(type.title, styles.title)}>{doc.title}</h2>
          <span {...stylex.props(type.code, styles.code)}>
            <span>{doc.code}</span> · <span>version {doc.version}</span>
            {doc.date && (
              <>
                {" · "}
                <span>{doc.date}</span>
              </>
            )}
          </span>
        </div>
        <span {...stylex.props(type.small, styles.facts)}>
          {running
            ? `Converting from ${from} · ${baseName(doc.source.name || doc.source.file)}`
            : converted
              ? `Converted from ${from} · ${plural(sections, "section")} · ${plural(figures, "figure")}`
              : `${from} file, not converted · ${baseName(doc.source.name || doc.source.file)}`}
        </span>
      </div>
      <div {...stylex.props(styles.acts)}>
        {reading && (
          <Tabs
            label="Document views"
            size="sm"
            inline
            value={view}
            onChange={onView}
            tabs={[
              { value: "text", label: "Text", icon: "text" },
              { value: "figures", label: "Figures", icon: "image", count: figures },
            ]}
          />
        )}
        {reading && sectionsButton && view === "text" && (
          <Button
            size="sm"
            variant="quiet"
            icon="list"
            label="Sections"
            expanded={drawer === "sections"}
            onClick={() => onDrawer("sections")}
          />
        )}
        {detailsButton && (
          <span {...stylex.props(styles.dotWrap)}>
            <Button
              size="sm"
              variant="quiet"
              icon="panel-right"
              label="Details"
              popup={{ kind: "dialog", open: drawer === "details" }}
              onClick={() => onDrawer("details")}
            />
            {warned && (
              <span data-testid="details-warned" title="Conversion warnings" {...stylex.props(styles.dot)}>
                <Badge dot tone="warning" label="Conversion warnings" />
              </span>
            )}
          </span>
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
