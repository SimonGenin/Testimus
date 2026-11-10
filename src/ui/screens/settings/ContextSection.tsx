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
import type { ListItemProps } from "../../components/ui/ListItem.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { Text } from "../../components/ui/Text.tsx";
import { type } from "../../components/ui/type.ts";
import { useRead } from "../../lib/data/query.ts";
import { fold } from "../../lib/format.ts";
import { errorToast } from "../../lib/toast.ts";
import { border, breakpoint, color, size, space } from "../../styles/tokens.stylex.ts";
import { ContextCard } from "./ContextCard.tsx";
import { CONTEXTS, type Entry, EVERY_RUN, entriesOf, entryName, type Given, matches, ORIGIN, where } from "./given.ts";
import { PromptCard } from "./PromptCard.tsx";
import { useInfo } from "./project.ts";
import { RunCard } from "./RunCard.tsx";
import { Hint, Section } from "./Section.tsx";

const styles = stylex.create({
  split: {
    display: "grid",
    gridTemplateColumns: { default: `minmax(0, ${size.sidebar}) minmax(0, 1fr)`, [breakpoint.sm]: "minmax(0, 1fr)" },
    gap: space.s6,
    alignItems: "start",
  },
  side: {
    position: { default: "sticky", [breakpoint.sm]: "static" },
    top: space.s5,
    minWidth: 0,
  },
  filter: { padding: space.s4 },
  scroll: {
    maxHeight: { default: `calc(100vh - ${size.topbar} * 2 - ${space.s8} * 2)`, [breakpoint.sm]: "none" },
    overflowY: "auto",
    borderTopStyle: "solid",
    borderTopWidth: border.width,
    borderTopColor: color.border,
  },
  empty: { paddingBlock: space.s3, paddingInline: space.s4 },
  emptyHead: { display: "flex", justifyContent: "space-between", gap: space.s3, margin: 0, color: color.text },
  count: { color: color.textSubtle },
  actions: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  copy: { paddingInline: space.s4, paddingBlockEnd: space.s4 },
  detail: { display: "flex", flexDirection: "column", gap: space.s6, minWidth: 0 },
  meta: { display: "inline-flex", alignItems: "center", gap: space.s2, minWidth: 0 },
  where: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: color.textMuted },
});

const place = (p: Given) =>
  p.origin === "skill" ? ORIGIN.skill : p.origin === "file" ? (p.path ?? ORIGIN.file) : ORIGIN[p.origin];

type Head = { key: string; kind: "group"; label: string; count: number; open: boolean };
type Line = Head | Entry;

const isHead = (l: Line): l is Head => l.kind === "group";

function row(l: Line): ListItemProps {
  if (isHead(l)) return { title: l.label, trail: String(l.count), expanded: l.open };
  if (l.kind === "context")
    return {
      title: entryName(l),
      depth: 1,
      badges: l.isDefault && <Badge size="sm" tone="success" icon="check" label="Default" />,
      meta: (
        <span {...stylex.props(styles.meta)}>
          <span {...stylex.props(styles.where)}>
            {where(l.context)} · {contextLine(l.context)}
          </span>
        </span>
      ),
    };
  if (l.kind === "run") return { title: l.given.name, depth: 1, trail: <Badge size="sm" tone="info" label="Run" /> };
  return {
    title: l.given.name,
    depth: 1,
    trail: <Badge size="sm" tone={l.given.origin === "skill" ? "claude" : "neutral"} label={place(l.given)} />,
  };
}

// ponytail: what Claude is given in this project, run by run — the saved contexts first (the part the user writes:
// created, edited and made a default of the project here), then what goes with every run, then each kind of run
// Testimus sends (what it is asked, what goes with it and why, what it may touch, what it gives back) and the pieces
// runs share. The list is a tree in its own scroll box, held in view beside the picked one's detail: only the group of
// the picked one is open, a filter opens every group it matches
export function ContextSection() {
  const q = useRead("claude.prompts", {});
  const saved = useRead("contexts.list", {});
  const attached = useRead("contexts.ofProject", {});
  const info = useInfo();
  const write = useContextWrite();
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [copying, setCopying] = useState(false);
  const defaults = info.data?.project.claude.contexts ?? [];
  const entries = entriesOf(q.data ?? [], saved.data ?? [], defaults);
  const words = fold(filter).split(/\s+/).filter(Boolean);
  const shown = entries.filter((e) => matches(e, words));
  const current = shown.find((e) => e.key === picked) ?? shown.find((e) => e.kind === "run") ?? shown[0];
  const isOpen = (label: string) =>
    words.length > 0 || (toggled[label] ?? (label === current?.group || label === CONTEXTS || label === EVERY_RUN));
  const lines: Line[] = [...new Set(shown.map((e) => e.group))].flatMap((label) => {
    const inGroup = shown.filter((e) => e.group === label);
    const open = isOpen(label);
    return [
      { key: `group:${label}`, kind: "group", label, count: inGroup.length, open } as Line,
      ...(open ? inGroup : []),
    ];
  });
  const pick = (key: string) => {
    setPicked(key);
    setToggled({});
  };
  const open = (key: string) => {
    setFilter("");
    pick(key);
  };
  const toggle = (key: string) => {
    const label = key.replace(/^group:/, "");
    setToggled((t) => ({ ...t, [label]: !isOpen(label) }));
  };
  const none = saved.data?.length === 0 && !words.length;

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
  const copied = (id: string) => open(`context:${id}`);

  return (
    <Section
      id="context"
      title="Context"
      wide
      intro="What Claude is given, run by run. This project's own contexts come first: they are the part you write. Below them, every kind of run Testimus starts, to read what it sends."
      actions={
        <>
          {!none && !copying && (
            <Button variant="quiet" icon="copy" label="Copy from a project…" onClick={() => setCopying(true)} />
          )}
          <Button variant="primary" icon="plus" label="New context" onClick={() => void create()} />
        </>
      }
    >
      {q.isError ? (
        <Banner tone="danger" title="What Claude is given could not be read">
          {q.error.message}
        </Banner>
      ) : (
        <div {...stylex.props(styles.split)}>
          <nav aria-label="Contexts and runs" {...stylex.props(styles.side)}>
            <Card padded={false}>
              <div {...stylex.props(styles.filter)}>
                <Text
                  type="search"
                  icon="filter"
                  ariaLabel="Filter what Claude is given"
                  placeholder="Filter runs, skills, contexts…"
                  value={filter}
                  onChange={setFilter}
                />
              </div>
              {copying && (
                <div {...stylex.props(styles.copy)}>
                  <CopyContext open onOpenChange={setCopying} onCopied={copied} />
                </div>
              )}
              <div {...stylex.props(styles.scroll)}>
                {none && !copying && (
                  <div {...stylex.props(styles.empty)}>
                    <Card dashed density="compact">
                      <p {...stylex.props(type.label, styles.emptyHead)}>
                        {CONTEXTS}
                        <span {...stylex.props(type.regular, styles.count)}>0</span>
                      </p>
                      <Hint>
                        Notes, files and folders Claude reads before it works: a glossary, house rules, screens of the
                        system under test.
                      </Hint>
                      <span {...stylex.props(styles.actions)}>
                        <Button size="sm" icon="plus" label="New context" onClick={() => void create()} />
                        <Button size="sm" icon="copy" label="Copy from a project…" onClick={() => setCopying(true)} />
                      </span>
                    </Card>
                  </div>
                )}
                <List
                  label="What Claude is given"
                  tree
                  items={lines}
                  getKey={(l) => l.key}
                  selected={current?.key ?? null}
                  onSelect={(key) => (key.startsWith("group:") ? toggle(key) : pick(key))}
                  onToggle={toggle}
                  loading={!q.data}
                  reading="claude.prompts"
                  empty={<EmptyState icon="filter" compact title={`Nothing matches “${filter.trim()}”.`} />}
                  renderItem={row}
                />
              </div>
            </Card>
          </nav>
          <div {...stylex.props(styles.detail)}>
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
