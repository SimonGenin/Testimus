import * as stylex from "@stylexjs/stylex";
import { useContext } from "react";
import type { SearchResult } from "../../../core/types.ts";
import { AppContext } from "../../lib/app.ts";
import { useCommand } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { errorToast, jobToast } from "../../lib/toast.ts";
import { border, breakpoint, color, space } from "../../styles/tokens.stylex.ts";
import { Badge } from "../ui/Badge.tsx";
import { Button } from "../ui/Button.tsx";
import { Chip } from "../ui/Chip.tsx";
import { Kbd } from "../ui/Kbd.tsx";
import { type } from "../ui/type.ts";

const styles = stylex.create({
  foot: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s5,
    paddingBlock: space.s3,
    paddingInline: space.s5,
    borderTopWidth: border.width,
    borderTopStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.canvas,
    color: color.textMuted,
  },
  keys: { display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: space.s5 },
  key: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  tips: {
    display: { default: "inline-flex", [breakpoint.narrow]: "none" },
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s2,
    marginInlineStart: "auto",
  },
});

const SYNTAX = ['"exact"', "-word"];
const KEYS = ["review:", "label:", "folder:", "has:", "in:"];

const keys = (pairs: [string, string][]) => (
  <span {...stylex.props(styles.keys)}>
    {pairs.map(([k, word]) => (
      <span key={k} {...stylex.props(styles.key)}>
        <Kbd>{k}</Kbd>
        {word}
      </span>
    ))}
  </span>
);

// ponytail: the keys and what the list is — a search (how to write a phrase or leave a word out, the filters
// search.all understands — a click writes one in the field and lists its values —, what the meaning pass says about
// the tests), the commands (a Jira write shows its plan first), or the commands alone, with no project open
export function PaletteFoot({
  mode = "search",
  result,
  searchingDeep,
  onNarrow,
}: {
  mode?: "search" | "commands" | "none";
  result: SearchResult | null;
  searchingDeep: boolean;
  onNarrow?: (key: string) => void;
}) {
  const index = useCommand("search.index", { invalidates: "none" });
  const app = useContext(AppContext);
  if (mode !== "search")
    return (
      <div {...stylex.props(type.small, styles.foot)}>
        {keys([
          ...(mode === "none" ? ([["↑↓", "move"]] as [string, string][]) : []),
          ["Enter", mode === "none" ? "run" : "open the form"],
          ["Esc", "close"],
        ])}
        <span {...stylex.props(styles.tips)}>
          {mode === "none" ? (
            <Badge label="Commands only" icon="terminal" size="sm" />
          ) : (
            "A Jira write always shows its plan first"
          )}
        </span>
      </div>
    );
  const unembedded = result?.meaning !== "unavailable" ? (result?.unembedded ?? 0) : 0;
  return (
    <div {...stylex.props(type.small, styles.foot)}>
      {keys([
        ["↑↓", "move"],
        ["Enter", "open"],
        ["Tab", "next kind"],
      ])}
      {unembedded > 0 ? (
        <Button
          variant="quiet"
          size="sm"
          icon="search"
          label={`${plural(unembedded, "test")} not searchable by meaning yet · Index`}
          loading={index.isPending}
          disabled={index.isSuccess}
          onClick={() =>
            index.mutate(
              {},
              {
                onSuccess: (r) =>
                  jobToast("Indexing the tests by meaning", (r as { jobId?: string } | null)?.jobId, (s, a) =>
                    app?.navigate(s, a),
                  ),
                onError: (e) => errorToast(e, "Could not index the tests"),
              },
            )
          }
        />
      ) : searchingDeep ? (
        <span>Searching by meaning…</span>
      ) : null}
      <span {...stylex.props(styles.tips)}>
        Narrow with
        {SYNTAX.map((n) => (
          <Chip key={n} label={n} mono square />
        ))}
        {KEYS.map((n) => (
          <Chip key={n} label={n} mono square onClick={onNarrow && (() => onNarrow(n))} />
        ))}
      </span>
    </div>
  );
}
