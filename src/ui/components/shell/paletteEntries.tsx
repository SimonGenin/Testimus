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

const GROUP_ICON: Record<string, IconName> = {
  docs: "documents",
  rag: "search",
  search: "search",
  chat: "claude",
  claude: "claude",
  tests: "tests",
  images: "image",
  gen: "generate",
  check: "review",
  review: "review",
  xray: "push",
  jobs: "jobs",
  system: "settings",
  project: "folder",
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
          lead: <Icon name={GROUP_ICON[c.name.split(".")[0]] ?? "chevron-right"} />,
          title: label,
          trail: side(c.name, undefined, hasInput(c)),
        },
        text: `${c.name} ${c.name.replace(".", " ")} ${c.summary}`.toLowerCase(),
        run: () => onCommand(c),
      };
    }),
  ];
}
