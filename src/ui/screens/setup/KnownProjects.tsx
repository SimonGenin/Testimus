import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { List } from "../../components/ui/List.tsx";
import { Menu, type MenuEntry } from "../../components/ui/Menu.tsx";
import { desktop, reveal } from "../../lib/desktop.ts";
import { initials } from "../../lib/format.ts";
import { color, fontFamily, fontSize, fontWeight, radius, size, space } from "../../styles/tokens.stylex.ts";
import { DeleteProject } from "./DeleteProject.tsx";
import { type Known, labelOf } from "./useProjects.ts";

const styles = stylex.create({
  avatar: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: size.controlMd,
    height: size.controlMd,
    borderRadius: radius.r2,
    backgroundColor: color.accentSubtle,
    color: color.accentText,
    fontSize: fontSize.small,
    fontWeight: fontWeight.semibold,
  },
  dir: { fontFamily: fontFamily.mono, overflowWrap: "anywhere" },
  trail: { display: "flex", alignItems: "center", gap: space.s2 },
  gone: { color: color.textMuted, fontSize: fontSize.small },
});

export function KnownProjects({
  known,
  current,
  busy,
  onOpen,
  onHide,
  onRemove,
}: {
  known: Known[];
  current?: string;
  busy: boolean;
  onOpen: (dir: string) => void;
  onHide: (k: Known) => void;
  onRemove: (k: Known, gone: boolean) => Promise<boolean>;
}) {
  const [del, setDel] = useState<Known | null>(null);
  const entries = (k: Known): MenuEntry[] => [
    ...(desktop() && k.exists ? [{ label: "Show in Explorer", icon: "folder-open" as const, onSelect: () => void reveal(k.dir) }] : []),
    { label: "Don't show", icon: "eye-off", hint: "forget it", onSelect: () => onHide(k) },
    "separator",
    {
      label: "Delete",
      icon: "trash",
      danger: true,
      disabled: busy,
      description: k.exists
        ? "Delete the project folder from this PC"
        : "The folder is already gone: remove the project from the list",
      onSelect: () => (k.exists ? setDel(k) : void onRemove(k, true)),
    },
  ];
  return (
    <>
      <List<Known>
        label="Known projects"
        selection="none"
        divided
        items={known}
        getKey={(k) => k.dir}
        renderItem={(k) => ({
          lead: <span {...stylex.props(styles.avatar)}>{initials(labelOf(k))}</span>,
          title: labelOf(k),
          badges: <Badge label={k.jiraProject || "no Jira key"} outline={!!k.jiraProject} size="sm" />,
          meta: <span {...stylex.props(styles.dir)}>{k.dir}</span>,
          trail: (
            <span {...stylex.props(styles.trail)}>
              {k.exists ? (
                <Button
                  size="sm"
                  variant={k.dir === current ? "secondary" : "primary"}
                  label={k.dir === current ? "Open again" : "Open"}
                  disabled={busy}
                  onClick={() => onOpen(k.dir)}
                />
              ) : (
                <span {...stylex.props(styles.gone)}>Folder not found</span>
              )}
              <Menu
                align="end"
                label={`More actions for ${labelOf(k)}`}
                entries={entries(k)}
                trigger={<Button variant="quiet" size="sm" icon="more" iconOnly label={`More actions for ${labelOf(k)}`} />}
              />
            </span>
          ),
        })}
      />
      {del && (
        <DeleteProject
          target={del}
          open={del.dir === current}
          onClose={() => setDel(null)}
          onDelete={() => onRemove(del, false)}
        />
      )}
    </>
  );
}
