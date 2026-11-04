import * as stylex from "@stylexjs/stylex";
import type { SearchResult } from "../../../core/types.ts";
import { useCommand } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { border, breakpoint, color, fontSize, lineHeight, space } from "../../styles/tokens.stylex.ts";
import { Button } from "../ui/Button.tsx";
import { Chip } from "../ui/Chip.tsx";
import { Kbd } from "../ui/Kbd.tsx";

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
    fontSize: fontSize.small,
    lineHeight: lineHeight.small,
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

// ponytail: the keys, the filters search.all understands, and what the meaning pass says about the tests
export function PaletteFoot({ result, searchingDeep }: { result: SearchResult | null; searchingDeep: boolean }) {
  const index = useCommand("search.index", { invalidates: "none" });
  const unembedded = result?.meaning !== "unavailable" ? (result?.unembedded ?? 0) : 0;
  return (
    <div {...stylex.props(styles.foot)}>
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
                  toast({ kind: "ok", title: "Indexing the tests by meaning", detail: "Follow it in Jobs." }),
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
