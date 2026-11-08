import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { List } from "../../components/ui/List.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { breakpoint, color, size, space } from "../../styles/tokens.stylex.ts";
import { type Given, PromptCard } from "./PromptCard.tsx";
import { Section } from "./Section.tsx";

const styles = stylex.create({
  split: {
    display: "grid",
    gridTemplateColumns: { default: `minmax(0, ${size.sidebar}) minmax(0, 1fr)`, [breakpoint.sm]: "minmax(0, 1fr)" },
    gap: space.s5,
    alignItems: "start",
  },
  side: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  shown: { position: { default: "sticky", [breakpoint.sm]: "static" }, top: space.s5, minWidth: 0 },
  meta: { display: "inline-flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  where: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: color.textMuted },
});

const ORIGIN: Record<Given["origin"], string> = {
  skill: "Skill",
  built: "Built by Testimus",
  file: "File",
  context: "Context",
};

const where = (p: Given) =>
  p.origin === "built" ? "per run" : p.origin === "skill" ? (p.path?.split("/").at(-2) ?? "") : (p.path ?? "");

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const matches = (p: Given, words: string[]) => {
  const hay = fold([p.name, p.group, ORIGIN[p.origin], p.path ?? "", p.usedBy.join(" "), p.text].join("\n"));
  return words.every((w) => hay.includes(w));
};

// ponytail: everything Claude is given in this project, read only — the skills, the prompts Testimus builds, CLAUDE.md
// and the contexts attached by default (claude.prompts); a filter, the list by use, and the picked one in full
export function ContextSection() {
  const q = useRead("claude.prompts", {});
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const words = fold(filter).split(/\s+/).filter(Boolean);
  const shown = (q.data ?? []).filter((p) => matches(p, words));
  const current = shown.find((p) => p.id === picked) ?? shown[0];
  const groups = [...new Set(shown.map((p) => p.group))].map((label) => {
    const keys = shown.filter((p) => p.group === label).map((p) => p.id);
    return { label, meta: String(keys.length), keys };
  });
  return (
    <Section
      id="context"
      title="Context"
      intro="Everything Claude is given, run by run: the skills, the prompts Testimus writes, the project rules and the attached contexts. Read only here — the skills and CLAUDE.md are files of the project folder."
    >
      {q.isError ? (
        <Banner tone="danger" title="What Claude is given could not be read">
          {q.error.message}
        </Banner>
      ) : (
        <div {...stylex.props(styles.split)}>
          <div {...stylex.props(styles.side)}>
            <Text
              type="search"
              icon="filter"
              ariaLabel="Filter prompts"
              placeholder="Filter prompts"
              value={filter}
              onChange={setFilter}
            />
            <Card padded={false}>
              <List
                label="What Claude is given"
                items={shown}
                getKey={(p) => p.id}
                groups={groups}
                density="two-line"
                selected={current?.id ?? null}
                onSelect={setPicked}
                loading={!q.data}
                empty={<EmptyState icon="filter" compact title={`Nothing matches “${filter.trim()}”.`} />}
                renderItem={(p) => ({
                  title: p.name,
                  meta: (
                    <span {...stylex.props(styles.meta)}>
                      <Badge size="sm" label={ORIGIN[p.origin]} />
                      <span {...stylex.props(type.code, styles.where)}>{where(p)}</span>
                    </span>
                  ),
                })}
              />
            </Card>
          </div>
          <div {...stylex.props(styles.shown)}>
            {current ? (
              <PromptCard key={current.id} prompt={current} />
            ) : (
              !q.data && (
                <Card>
                  <Skeleton lines={8} />
                </Card>
              )
            )}
          </div>
        </div>
      )}
    </Section>
  );
}
