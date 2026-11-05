import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef } from "react";
import { Icon } from "../../components/ui/Icon.tsx";
import { List } from "../../components/ui/List.tsx";
import { type } from "../../components/ui/type.ts";
import { plural } from "../../lib/format.ts";
import { isObserved } from "../../lib/media.ts";
import { into } from "../../lib/scroll.ts";
import { color, space } from "../../styles/tokens.stylex.ts";

const styles = stylex.create({
  pane: { display: "flex", flexDirection: "column", minHeight: 0, flex: 1, minWidth: 0 },
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
  // ponytail: the annexes (photos of the real system) after the body, under a head of their own
  const body = sections.filter((t) => !isObserved(t.anchor));
  const annexes = sections.filter((t) => isObserved(t.anchor));
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new current section moves the picked row in the DOM
  useLayoutEffect(() => {
    const b = box.current;
    const on = b?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (b && on) b.scrollTop += into(b, on);
  }, [current]);
  return (
    <nav aria-label="Sections" {...stylex.props(styles.pane)}>
      <div ref={box} data-testid="doc-toc" {...stylex.props(styles.body)}>
        <List
          label="Contents"
          items={sections}
          getKey={(t) => t.anchor}
          selected={sections.some((t) => t.anchor === current) ? current : null}
          onSelect={onGo}
          groups={
            head || annexes.length
              ? [
                  { label: "Contents", meta: plural(body.length, "section"), keys: body.map((t) => t.anchor) },
                  ...(annexes.length
                    ? [
                        {
                          label: "Annexes · observed",
                          meta: ((n) => `${n} ${n === 1 ? "batch" : "batches"}`)(
                            annexes.filter((t) => t.level === 0).length,
                          ),
                          keys: annexes.map((t) => t.anchor),
                        },
                      ]
                    : []),
                ]
              : undefined
          }
          renderItem={(t) => ({
            title: t.title,
            depth: isObserved(t.anchor) ? t.level : Math.max(0, t.level - 1),
            lead: NUMBERED.test(t.anchor) ? (
              <span {...stylex.props(type.code, styles.number)}>{t.anchor.slice(1)}</span>
            ) : isObserved(t.anchor) && t.level === 0 ? (
              <Icon name="image" size="sm" />
            ) : undefined,
          })}
        />
      </div>
    </nav>
  );
}
