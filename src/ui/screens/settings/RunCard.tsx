import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Badge } from "../../components/ui/Badge.tsx";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { type Fact as FactItem, Facts } from "../../components/ui/Facts.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Raw } from "../../components/ui/Raw.tsx";
import { Skeleton } from "../../components/ui/Skeleton.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { heldChars, type Piece, type Run, slots, tokens } from "./given.ts";
import { PieceList } from "./PieceList.tsx";
import { Fact, Group, Hint, Row } from "./Section.tsx";

const styles = stylex.create({
  detail: { display: "flex", flexDirection: "column", gap: space.s6, minWidth: 0 },
  title: { display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: space.s3 },
  line: { margin: 0, minWidth: 0, overflowWrap: "anywhere" },
  muted: { color: color.textMuted },
  path: { margin: 0, color: color.textMuted, overflowWrap: "anywhere" },
  tools: { display: "flex", flexWrap: "wrap", gap: space.s2 },
  links: { display: "flex", flexWrap: "wrap", gap: space.s4 },
});

const ASKED: Piece["kind"][] = ["instruction", "skill"];
const INSTRUCTION = "instruction";
// ponytail: what goes with a run shows its first pieces and folds the rest; a text shows its first lines
const FIRST_PIECES = 3;
const FIRST_LINES = 8;

const NOUN: Record<Piece["kind"], string> = {
  instruction: "instruction",
  skill: "skill",
  rules: "project file",
  tools: "tool",
  overview: "overview",
  context: "saved context",
  document: "document",
  docnote: "note",
  note: "note",
  conversation: "conversation",
};

// ponytail: « 3 documents, 3 notes » — what a fold holds, by kind, in the order they come
function holds(pieces: Piece[]): string {
  const counts = new Map<string, number>();
  for (const p of pieces) counts.set(NOUN[p.kind], (counts.get(NOUN[p.kind]) ?? 0) + 1);
  return [...counts].map(([noun, n]) => plural(n, noun)).join(", ");
}

// ponytail: where a piece of a run is listed in the section, when it is — its skill, the project rules, how the
// documents fit together, a saved context: the run's detail leads there
const entryOf = (p: Piece) =>
  p.kind === "skill" || p.kind === "context"
    ? p.id
    : p.kind === "rules"
      ? "file:CLAUDE.md"
      : p.kind === "overview"
        ? "file:docs/OVERVIEW.md"
        : undefined;

// ponytail: the app's commands a run may call, as Claude calls them (tests_create), gathered by their group so 137 of
// them still read
function byGroup(tools: string[]): FactItem[] {
  const groups = new Map<string, string[]>();
  for (const t of tools) {
    const [group, ...verb] = t.split("_");
    groups.set(group, [...(groups.get(group) ?? []), verb.join("_") || group]);
  }
  return [...groups].map(([label, verbs]) => ({ label, value: verbs.join(" · ") }));
}

const copy = (name: string, text: string) =>
  navigator.clipboard
    .writeText(text)
    .then(() => toast({ tone: "neutral", title: `“${name}” copied` }))
    .catch((e) => errorToast(e, "Could not copy the text"));

// ponytail: one run, as a person asks about it — which screens and commands send it and what it weighs, what Claude is
// asked (the instruction's template, the skill it names), what goes with it (claude.preview for the project's
// defaults: the very pieces the run is sent, each with why and its weight), the prompt or the piece picked in a table,
// what it may touch and what it gives back
export function RunCard({
  run: p,
  listed,
  onOpen,
}: {
  run: Run;
  /** whether the section lists an entry of this key (a skill, a file, a saved context) */
  listed: (key: string) => boolean;
  onOpen: (key: string) => void;
}) {
  const app = useApp();
  const preview = useRead("claude.preview", { use: p.id });
  const [picked, setPicked] = useState(INSTRUCTION);
  const [allPieces, setAllPieces] = useState(false);
  const [whole, setWhole] = useState<string | null>(null);
  const pieces = (preview.data?.pieces ?? []).filter((x) => x.kind !== "tools");
  const asked = pieces.filter((x) => ASKED.includes(x.kind));
  const along = pieces.filter((x) => !ASKED.includes(x.kind));
  const total = heldChars(pieces);
  const searched = pieces.filter((x) => x.on && x.kind === "document").length;
  const piece = pieces.find((x) => x.id === picked);
  const shown = piece ?? {
    kind: INSTRUCTION,
    name: p.name,
    why: "What Testimus asks of this run, with your request",
    text: p.text,
    path: undefined,
    detail: undefined,
    id: INSTRUCTION,
  };
  const entry = piece && entryOf(piece);
  const filled = slots(p.text);
  const waiting = !preview.data && !preview.isError;
  const pickedLate = along.findIndex((x) => x.id === picked) >= FIRST_PIECES;
  const folded = allPieces || pickedLate ? [] : along.slice(FIRST_PIECES);
  const list = (label: string, rows: Piece[]) => (
    <PieceList label={label} pieces={rows} total={total} selected={picked} onSelect={setPicked} loading={waiting} />
  );
  const lines = shown.text?.split("\n") ?? [];
  const cut = whole !== shown.id && lines.length > FIRST_LINES;
  const path = [shown.path ?? (shown.kind === INSTRUCTION ? "Built per run — not a file" : ""), shown.detail]
    .filter(Boolean)
    .join(" · ");
  const open = entry && listed(entry) ? entry : undefined;
  return (
    <section aria-label={p.name} {...stylex.props(styles.detail)}>
      <Group
        title={
          <span {...stylex.props(styles.title)}>
            {p.name}
            <Badge size="sm" tone="info" label="Run" />
          </span>
        }
        actions={<Button size="sm" icon="copy" label="Copy the prompt" onClick={() => void copy(p.name, p.text)} />}
      >
        <Row>
          <Fact label="Sent by">{p.usedBy.join(" · ")}</Fact>
        </Row>
        <Row>
          <Fact label="Kind of run">
            <span>
              <span {...stylex.props(type.code)}>{p.kind}</span>
              <span {...stylex.props(styles.muted)}> — it decides the tools and what goes with the run</span>
            </span>
          </Fact>
        </Row>
        {preview.isError ? (
          <Row>
            <Banner tone="danger" compact title="What this run is given could not be read">
              {preview.error.message}
            </Banner>
          </Row>
        ) : (
          <Row>
            <Fact label="Weight">
              {preview.data ? (
                <span>
                  {`Claude holds ${tokens(total)} as the run starts: what is said, loaded or read first${
                    searched ? `. ${plural(searched, "document")} more to search, never sent whole` : ""
                  }.`}
                </span>
              ) : (
                <Skeleton lines={1} />
              )}
            </Fact>
          </Row>
        )}
      </Group>
      {!preview.isError && (
        <Group title="What Claude is asked">
          <Row>
            {list("What Claude is asked", asked)}
            {waiting && <Loading read="claude.preview" />}
          </Row>
        </Group>
      )}
      {!preview.isError && (
        <Group title="What goes with it" note="With the project's defaults: a request may attach or leave out a piece.">
          <Row>
            {list("What goes with it", folded.length ? along.slice(0, FIRST_PIECES) : along)}
            {folded.length > 0 && (
              <span>
                <Button
                  size="sm"
                  variant="quiet"
                  expanded={false}
                  label={`${plural(folded.length, "more piece")}: ${holds(folded)}`}
                  onClick={() => setAllPieces(true)}
                />
              </span>
            )}
          </Row>
          <Row>
            <Facts
              size="sm"
              label="What goes with every run of this kind"
              items={[
                { label: "Saved contexts", value: p.takes.contexts },
                {
                  label: "How the documents fit together",
                  value: p.takes.overview
                    ? "Claude is told to read it first, while it is given to every run (Settings › Claude)"
                    : "Not given to this kind of run",
                },
                {
                  label: "Documents",
                  value: p.takes.documents
                    ? "Searched: every converted document is listed in a request, and one can be left out"
                    : "Not searched: the run works on the files of what it is about",
                },
              ]}
            />
          </Row>
        </Group>
      )}
      <Group
        title={shown.kind === INSTRUCTION ? "The prompt" : shown.name}
        note={shown.why}
        footer={
          shown.kind === INSTRUCTION &&
          filled.length > 0 && (
            <Hint>Built by Testimus for each run: the parts in braces are filled then — {filled.join(", ")}.</Hint>
          )
        }
      >
        {path && (
          <Row>
            <p {...stylex.props(type.code, styles.path)}>{path}</p>
          </Row>
        )}
        <Row>
          {shown.text !== undefined ? (
            <Raw
              text={cut ? lines.slice(0, FIRST_LINES).join("\n") : shown.text}
              label={`Text of ${shown.name}`}
              empty="(empty)"
            />
          ) : (
            <p {...stylex.props(type.small, styles.line, styles.muted)}>
              {shown.kind === "document"
                ? "Claude searches it and reads the passages it finds: it is never sent whole."
                : "It has no text of its own."}
            </p>
          )}
          {(cut || open || shown.kind === "document") && (
            <span {...stylex.props(styles.links)}>
              {cut && (
                <Button
                  size="sm"
                  variant="quiet"
                  expanded={false}
                  label={`Show all of it, ${lines.length} lines`}
                  onClick={() => setWhole(shown.id)}
                />
              )}
              {open && <Button variant="link" label="Open it in the list" onClick={() => onOpen(open)} />}
              {shown.kind === "document" && (
                <Button
                  variant="link"
                  label="Open the document"
                  onClick={() => app.navigate("documents", shown.id.replace(/^doc:/, ""))}
                />
              )}
            </span>
          )}
        </Row>
      </Group>
      <Group title="What it may touch, what it gives back">
        <Row>
          <Fact label="Commands of the app">
            <span>
              {p.takes.tools.length
                ? `${plural(p.takes.tools.length, "command")}, as tools — nothing else of the app can be called`
                : "None"}
            </span>
            {p.takes.tools.length > 0 && (
              <Disclosure quiet summary="The commands it may call" count={p.takes.tools.length}>
                <Facts size="sm" label="The commands it may call" items={byGroup(p.takes.tools)} />
              </Disclosure>
            )}
          </Fact>
        </Row>
        <Row>
          <Fact label="Claude Code's own tools">
            {p.takes.files.length ? (
              <span {...stylex.props(styles.tools)}>
                {p.takes.files.map((t) => (
                  <Badge key={t} size="sm" label={t} />
                ))}
              </span>
            ) : (
              "None"
            )}
          </Fact>
        </Row>
        {p.answers && (
          <Row>
            <Fact label="Gives back">
              <p {...stylex.props(type.compact, styles.line, styles.muted)}>{p.answers}</p>
            </Fact>
          </Row>
        )}
      </Group>
    </section>
  );
}
