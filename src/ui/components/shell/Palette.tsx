import { useMemo, useState } from "react";
import type { CommandInfo } from "../../api.ts";
import { cx } from "../../lib/format.ts";
import { Icon, type IconName, Kbd } from "../ui/index.ts";

export type PaletteAction = { id: string; label: string; icon?: IconName; hint?: string; run: () => void };

type Entry = { id: string; label: string; icon: IconName; hint?: string; text: string; run: () => void };

const GROUP_ICON: Record<string, IconName> = {
  docs: "documents",
  rag: "search",
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

export const firstSentence = (s: string) => s.split(/(?<=[.:])\s|\s\(/)[0].replace(/[.:]$/, "");

export function filterEntries<T extends { text: string }>(entries: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return entries;
  return entries.filter((e) => words.every((w) => e.text.includes(w)));
}

export function Palette({
  commands,
  actions,
  onCommand,
  onAsk,
  onClose,
}: {
  commands: CommandInfo[];
  actions: PaletteAction[];
  onCommand: (c: CommandInfo) => void;
  onAsk?: (question: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [at, setAt] = useState(0);
  const entries = useMemo<Entry[]>(
    () => [
      ...actions.map((a) => ({
        id: a.id,
        label: a.label,
        icon: a.icon ?? "right",
        hint: a.hint,
        text: `${a.label} ${a.hint ?? ""}`.toLowerCase(),
        run: a.run,
      })),
      ...commands.map((c) => ({
        id: c.name,
        label: firstSentence(c.summary) || c.name,
        icon: GROUP_ICON[c.name.split(".")[0]] ?? "right",
        hint: c.name.replace(".", " "),
        text: `${c.name} ${c.name.replace(".", " ")} ${c.summary}`.toLowerCase(),
        run: () => onCommand(c),
      })),
    ],
    [actions, commands, onCommand],
  );
  const shown = filterEntries(entries, query).slice(0, 60);
  const ask = query.trim() && onAsk ? query.trim() : "";
  const total = shown.length + (ask ? 1 : 0);
  const keepInView = (el: HTMLDivElement | null) => el?.scrollIntoView?.({ block: "nearest" });
  const pick = (i: number) => {
    onClose();
    if (i < shown.length) shown[i].run();
    else if (ask) onAsk?.(ask);
  };
  return (
    <div className="overlay overlay-top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette card" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-search">
          <Icon name="search" />
          <input
            autoFocus
            aria-label="Command"
            placeholder="Search or run a command"
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            onChange={(e) => {
              setQuery(e.target.value);
              setAt(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setAt((v) => Math.min(v + 1, total - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setAt((v) => Math.max(v - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (total) pick(at);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />
        </div>
        <div className="palette-list" id="palette-list" role="listbox" aria-label="Commands">
          {shown.map((e, i) => (
            <div
              key={e.id}
              className={cx("pal", i === at && "pal-on")}
              role="option"
              aria-selected={i === at}
              ref={i === at ? keepInView : undefined}
              tabIndex={-1}
              onMouseEnter={() => setAt(i)}
              onClick={() => pick(i)}
            >
              <Icon name={e.icon} />
              <span className="pal-label">{e.label}</span>
              {e.hint && <span className="mono muted">{e.hint}</span>}
              {i === at && <Kbd>Enter</Kbd>}
            </div>
          ))}
          {ask && (
            <div
              className={cx("pal", at === shown.length && "pal-on")}
              role="option"
              aria-selected={at === shown.length}
              ref={at === shown.length ? keepInView : undefined}
              tabIndex={-1}
              onMouseEnter={() => setAt(shown.length)}
              onClick={() => pick(shown.length)}
            >
              <Icon name="claude" />
              <span className="pal-label">Ask the documents: “{ask}”</span>
              <span className="mono muted">chat ask</span>
            </div>
          )}
          {!total && <p className="muted palette-empty">Nothing matches “{query}”.</p>}
        </div>
      </div>
    </div>
  );
}
