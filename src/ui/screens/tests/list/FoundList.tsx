import * as stylex from "@stylexjs/stylex";
import type { LocalTestRef, SearchMatch } from "../../../../core/types.ts";
import { List } from "../../../components/ui/List.tsx";
import { plural } from "../../../lib/format.ts";
import { color, fontSize, space } from "../../../styles/tokens.stylex.ts";
import { Marked, TestMeta, Where } from "./rows.tsx";

const styles = stylex.create({
  snip: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  text: { fontSize: fontSize.small, color: color.textMuted, overflow: "hidden", textOverflow: "ellipsis" },
});

export type Found = { hit: SearchMatch; ref: LocalTestRef };

// ponytail: the local tests a filter found (search.all on the tests: words, steps, sources, review:…), the ones found by
// their words first, then the ones found by their meaning
export function FoundList({
  found,
  searching,
  activeId,
  onOpen,
}: {
  found: Found[];
  searching: boolean;
  activeId: string;
  onOpen: (f: Found) => void;
}) {
  const words = found.filter((f) => f.hit.why !== "meaning");
  const near = found.filter((f) => f.hit.why === "meaning");
  const byId = new Map(found.map((f) => [f.ref.id, f]));
  return (
    <List<Found>
      label="Tests found"
      items={found}
      getKey={(f) => f.ref.id}
      selected={activeId}
      density="two-line"
      onSelect={(id) => {
        const f = byId.get(id);
        if (f) onOpen(f);
      }}
      groups={[
        {
          label: plural(words.length, "test"),
          meta: searching ? "searching by meaning…" : undefined,
          keys: words.map((f) => f.ref.id),
        },
        { label: "Similar by meaning", keys: near.map((f) => f.ref.id) },
      ]}
      renderItem={({ hit, ref: r }) => ({
        title: <Marked text={hit.title} marks={hit.titleMarks} />,
        tooltip: hit.title,
        meta: (
          <span {...stylex.props(styles.snip)}>
            <span {...stylex.props(styles.text)}>
              {hit.snippet !== undefined ? (
                <>
                  {hit.where && <Where text={hit.where} />}
                  <Marked text={hit.snippet} marks={hit.marks} />
                </>
              ) : (
                r.folder || "/"
              )}
            </span>
            <TestMeta r={r} />
          </span>
        ),
      })}
    />
  );
}
