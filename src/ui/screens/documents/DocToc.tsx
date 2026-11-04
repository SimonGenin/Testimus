import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef } from "react";
import { List } from "../../components/ui/List.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { into } from "./scroll.ts";

const styles = stylex.create({
  pane: { display: "flex", flexDirection: "column", minHeight: 0, flex: 1, minWidth: 0 },
  head: {
    boxSizing: "border-box",
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.s3,
    paddingTop: space.s4,
    paddingBottom: space.s2,
    paddingInline: space.s5,
    color: color.textMuted,
  },
  count: { color: color.textSubtle },
  body: { boxSizing: "border-box", flex: 1, minHeight: 0, overflowY: "auto", paddingBottom: space.s3 },
  number: { color: color.textSubtle },
});

export type TocEntry = { anchor: string; title: string; level: number };

const NUMBERED = /^§\d+(\.\d+)*$/;

// ponytail: the sections of the document, indented by depth; the current one is picked and kept in view
export function DocToc({
  sections,
  current,
  head = true,
  onGo,
}: {
  sections: TocEntry[];
  current: string;
  head?: boolean;
  onGo: (anchor: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new current section moves the picked row in the DOM
  useLayoutEffect(() => {
    const b = box.current;
    const on = b?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (b && on) b.scrollTop += into(b, on);
  }, [current]);
  return (
    <nav aria-label="Sections" {...stylex.props(styles.pane)}>
      {head && (
        <div {...stylex.props(type.small, type.strong, styles.head)}>
          Contents <span {...stylex.props(type.regular, styles.count)}>{plural(sections.length, "section")}</span>
        </div>
      )}
      <div ref={box} data-testid="doc-toc" {...stylex.props(styles.body)}>
        <List
          label="Contents"
          items={sections}
          getKey={(t) => t.anchor}
          selected={sections.some((t) => t.anchor === current) ? current : null}
          onSelect={onGo}
          renderItem={(t) => ({
            title: t.title,
            depth: Math.max(0, t.level - 1),
            lead: NUMBERED.test(t.anchor) ? (
              <span {...stylex.props(type.code, styles.number)}>{t.anchor.slice(1)}</span>
            ) : undefined,
          })}
        />
      </div>
    </nav>
  );
}
