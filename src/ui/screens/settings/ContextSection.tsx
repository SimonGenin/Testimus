import * as stylex from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import { CopyContext } from "../../components/claude/CopyContext.tsx";
import { contextLine, useContextWrite } from "../../components/claude/contexts.ts";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { EmptyState } from "../../components/ui/EmptyState.tsx";
import { List } from "../../components/ui/List.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { fold } from "../../lib/format.ts";
import { errorToast } from "../../lib/toast.ts";
import { breakpoint, color, size, space } from "../../styles/tokens.stylex.ts";
import { ContextCard } from "./ContextCard.tsx";
import { type Entry, entriesOf, entryName, type Given, matches, ORIGIN, where } from "./given.ts";
import { PromptCard } from "./PromptCard.tsx";
import { useInfo } from "./project.ts";
import { RunCard } from "./RunCard.tsx";
import { Hint, Section } from "./Section.tsx";

const styles = stylex.create({
  split: {
    display: "grid",
    gridTemplateColumns: { default: `minmax(0, ${size.sidebar}) minmax(0, 1fr)`, [breakpoint.sm]: "minmax(0, 1fr)" },
    gap: space.s5,
    alignItems: "start",
  },
  side: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  shown: { minWidth: 0 },
  meta: { display: "inline-flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  where: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: color.textMuted },
});

const place = (p: Given) =>
  p.origin === "built" ? "per run" : p.origin === "skill" ? (p.path?.split("/").at(-2) ?? "") : (p.path ?? "");

function row(e: Entry) {
  if (e.kind === "context")
    return {
      title: entryName(e),
      badges: e.isDefault && <Badge size="sm" tone="success" icon="check" label="Default" />,
      meta: (
        <span {...stylex.props(styles.meta)}>
          <Badge size="sm" label={ORIGIN.context} />
          <span {...stylex.props(styles.where)}>
            {where(e.context)} · {contextLine(e.context)}
          </span>
        </span>
      ),
    };
  if (e.kind === "run")
    return {
      title: e.given.name,
      meta: (
        <span {...stylex.props(styles.meta)}>
          <Badge size="sm" tone="claude" label="Run" />
          <span {...stylex.props(type.code, styles.where)}>{e.given.kind}</span>
        </span>
      ),
    };
  return {
    title: e.given.name,
    meta: (
      <span {...stylex.props(styles.meta)}>
        <Badge size="sm" label={ORIGIN[e.given.origin]} />
        <span {...stylex.props(type.code, styles.where)}>{place(e.given)}</span>
      </span>
    ),
  };
}

// ponytail: what Claude is given in this project, run by run — each run Testimus sends (what it is asked, what goes
// with it and why, what it may touch, what it gives back), the pieces runs share (skills, CLAUDE.md, how the documents
// fit together) and the saved contexts, the team's own pieces: the one place they are created, edited, shared, deleted
// and made a default of the project. One list with a filter, the picked one in full beside it
export function ContextSection() {
  const q = useRead("claude.prompts", {});
  const saved = useRead("contexts.list", {});
  const attached = useRead("contexts.ofProject", {});
  const info = useInfo();
  const write = useContextWrite();
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const defaults = info.data?.project.claude.contexts ?? [];
  const entries = entriesOf(q.data ?? [], saved.data ?? [], defaults);
  const words = fold(filter).split(/\s+/).filter(Boolean);
  const shown = entries.filter((e) => matches(e, words));
  const current = shown.find((e) => e.key === picked) ?? shown.find((e) => e.kind === "run") ?? shown[0];
  const groups = [...new Set(shown.map((e) => e.group))].map((label) => {
    const keys = shown.filter((e) => e.group === label).map((e) => e.key);
    return { label, meta: String(keys.length), keys };
  });
  const open = (key: string) => {
    setFilter("");
    setPicked(key);
  };

  useEffect(() => {
    if (saved.error) errorToast(saved.error, "Could not list the saved contexts");
  }, [saved.error]);

  const create = async () => {
    try {
      // ponytail: like Xray Editor, a new context is seen by every project; « Shared with every project » unticks it
      const c = await write("contexts.create", { shared: true });
      if (c) open(`context:${c.id}`);
    } catch (e) {
      errorToast(e, "Could not create the context");
    }
  };

  return (
    <Section
      id="context"
      title="Context"
      intro="What Claude is given, run by run: what it is asked, what goes with it and why, what it may touch and what it gives back. The saved contexts are the team's own pieces — created, edited, shared and made a default of the project here. The skills and CLAUDE.md are files of the project folder."
      actions={<Button icon="plus" label="New context" onClick={() => void create()} />}
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
              ariaLabel="Filter what Claude is given"
              placeholder="Filter runs, skills, contexts…"
              value={filter}
              onChange={setFilter}
            />
            <Card padded={false}>
              <List
                label="What Claude is given"
                items={shown}
                getKey={(e) => e.key}
                groups={groups}
                density="two-line"
                selected={current?.key ?? null}
                onSelect={setPicked}
                loading={!q.data}
                reading="claude.prompts"
                empty={<EmptyState icon="filter" compact title={`Nothing matches “${filter.trim()}”.`} />}
                renderItem={row}
              />
            </Card>
            {saved.data?.length === 0 && (
              <Hint>
                No saved context yet. A context is notes, copied files and outside paths Claude reads before it works —
                a glossary, house rules, the screens of the system under test.
              </Hint>
            )}
            <CopyContext onCopied={(id) => open(`context:${id}`)} />
          </div>
          <div {...stylex.props(styles.shown)}>
            {current?.kind === "run" ? (
              <RunCard
                key={current.key}
                run={current.given}
                listed={(key) => entries.some((e) => e.key === key)}
                onOpen={open}
              />
            ) : current?.kind === "piece" ? (
              <PromptCard key={current.key} prompt={current.given} />
            ) : current?.kind === "context" ? (
              <ContextCard
                key={current.key}
                context={current.context}
                defaults={defaults}
                onTests={!current.isDefault && !!attached.data?.effective.includes(current.context.id)}
                onDeleted={() => setPicked(null)}
              />
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
