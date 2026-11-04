import * as stylex from "@stylexjs/stylex";
import type { SearchResult } from "../../../core/types.ts";
import { useCommand } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
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
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderTopWidth: border.width,
    borderTopStyle: "solid",
    borderColor: color.border,
    backgroundColor: color.canvas,
    color: color.textMuted,
  },
  keys: { display: "inline-flex", alignItems: "center", gap: space.s2 },
  tips: {
    display: { default: "inline-flex", [breakpoint.narrow]: "none" },
    alignItems: "center",
    flexWrap: "wrap",
    gap: space.s2,
    marginInlineStart: "auto",
  },
});

const NARROW = ['"exact"', "-word", "review:to-fix", "label:", "folder:"];

// ponytail: the keys and what the list is — a search (the filters search.all understands, what the meaning pass says
// about the tests), the commands (a Jira write shows its plan first), or the commands alone, with no project open
export function PaletteFoot({
  mode = "search",
  result,
  searchingDeep,
}: {
  mode?: "search" | "commands" | "none";
  result: SearchResult | null;
  searchingDeep: boolean;
}) {
  const index = useCommand("search.index", { invalidates: "none" });
  if (mode !== "search")
    return (
      <div {...stylex.props(type.small, styles.foot)}>
        <span {...stylex.props(styles.keys)}>
          {mode === "none" && <Kbd>↑↓</Kbd>}
          {mode === "none" && " move "}
          <Kbd>Enter</Kbd> {mode === "none" ? "run" : "open the form"} <Kbd>Esc</Kbd> close
        </span>
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
      <span {...stylex.props(styles.keys)}>
        <Kbd>↑↓</Kbd> move <Kbd>Enter</Kbd> open <Kbd>Tab</Kbd> next kind
      </span>
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
                onSuccess: () =>
                  toast({ tone: "success", title: "Indexing the tests by meaning", detail: "Follow it in Jobs." }),
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
        {NARROW.map((n) => (
          <Chip key={n} label={n} mono />
        ))}
      </span>
    </div>
  );
}
