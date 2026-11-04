import * as stylex from "@stylexjs/stylex";
import type { CommandInfo } from "../../lib/data/client.ts";
import { color, fontFamily, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Icon, type IconName } from "../ui/Icon.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import type { ListItemProps } from "../ui/ListItem.tsx";

export type PaletteAction = {
  id: string;
  label: string;
  icon?: IconName;
  /** words on the right (« #/documents », « theme ») */
  hint?: string;
  shortcut?: string;
  /** « Go to » (the screens) or « App » (the shell's own toggles) */
  group?: "Go to" | "App";
  run: () => void;
};

export type Entry = {
  id: string;
  label: string;
  group: "Go to" | "App" | "Commands";
  row: ListItemProps;
  text: string;
  run: () => void;
};

// ponytail: a command is a chevron, as the design draws it; the few it marks carry their own icon
const COMMAND_ICON: Record<string, IconName> = {
  "chat.ask": "claude",
  "xray.push": "push",
  "xray.pushFolder": "push",
  "xray.unpush": "undo",
};

const styles = stylex.create({
  side: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  hint: {
    fontFamily: fontFamily.mono,
    fontSize: fontSize.code,
    lineHeight: lineHeight.code,
    color: color.textMuted,
    whiteSpace: "nowrap",
  },
});

export const firstSentence = (s: string) => s.split(/(?<=[.:])\s|\s\(/)[0].replace(/[.:]$/, "");

export const hasInput = (c: CommandInfo) => Object.keys(c.input?.properties ?? {}).length > 0;

// ponytail: with nothing typed, the commands people reach for first lead the list (the design's selection), then
// every other command by name — the list stays the whole registry
const FEATURED = ["project.openKey", "docs.show", "chat.ask", "review.queue", "xray.push", "system.doctor"];

export function featuredFirst<T extends { id: string }>(entries: T[]): T[] {
  const rank = (e: T) => (FEATURED.includes(e.id) ? FEATURED.indexOf(e.id) : FEATURED.length);
  return [...entries].sort((a, b) => rank(a) - rank(b));
}

export function filterEntries<T extends { text: string }>(entries: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  return entries.filter((e) => words.every((w) => e.text.includes(w)));
}

function side(hint?: string, shortcut?: string, input?: boolean) {
  return (
    <span {...stylex.props(styles.side)}>
      {shortcut && <Kbd>{shortcut}</Kbd>}
      {hint && <span {...stylex.props(styles.hint)}>{hint}</span>}
      {input && <Badge label="needs input" icon="text" size="sm" />}
    </span>
  );
}

// ponytail: the screens and toggles of the shell, then every command of the registry (by its summary's first sentence)
export function entriesOf(
  actions: PaletteAction[],
  commands: CommandInfo[],
  onCommand: (c: CommandInfo) => void,
): Entry[] {
  return [
    ...actions.map(
      (a): Entry => ({
        id: a.id,
        label: a.label,
        group: a.group ?? "App",
        row: { lead: <Icon name={a.icon ?? "chevron-right"} />, title: a.label, trail: side(a.hint, a.shortcut) },
        text: `${a.label} ${a.hint ?? ""}`.toLowerCase(),
        run: a.run,
      }),
    ),
    ...commands.map((c): Entry => {
      const label = firstSentence(c.summary) || c.name;
      return {
        id: c.name,
        label,
        group: "Commands",
        row: {
          lead: <Icon name={COMMAND_ICON[c.name] ?? "chevron-right"} />,
          title: label,
          trail: side(c.name, undefined, hasInput(c)),
        },
        text: `${c.name} ${c.name.replace(".", " ")} ${c.summary}`.toLowerCase(),
        run: () => onCommand(c),
      };
    }),
  ];
}
