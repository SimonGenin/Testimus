import * as stylex from "@stylexjs/stylex";
import { type ReactNode, useState } from "react";
import { Banner } from "../../components/ui/Banner.tsx";
import { Button } from "../../components/ui/Button.tsx";
import { Card } from "../../components/ui/Card.tsx";
import { Disclosure } from "../../components/ui/Disclosure.tsx";
import { type Fact, Facts } from "../../components/ui/Facts.tsx";
import { Loading } from "../../components/ui/Loading.tsx";
import { Raw } from "../../components/ui/Raw.tsx";
import { type } from "../../components/ui/type.ts";
import { useApp } from "../../lib/app.ts";
import { useRead } from "../../lib/data/query.ts";
import { plural } from "../../lib/format.ts";
import { errorToast, toast } from "../../lib/toast.ts";
import { color, space } from "../../styles/tokens.stylex.ts";
import { heldChars, type Piece, type Run, slots, tokens } from "./given.ts";
import { PieceList } from "./PieceList.tsx";

const styles = stylex.create({
  body: { display: "flex", flexDirection: "column", gap: space.s6, minWidth: 0 },
  part: { display: "flex", flexDirection: "column", gap: space.s3, minWidth: 0 },
  head: { display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: space.s4, rowGap: space.s1, margin: 0 },
  title: { margin: 0 },
  line: { margin: 0, minWidth: 0, overflowWrap: "anywhere" },
  muted: { color: color.textMuted },
  path: { margin: 0, color: color.textMuted, overflowWrap: "anywhere" },
  foot: { margin: 0, color: color.textMuted },
});

const ASKED: Piece["kind"][] = ["instruction", "skill"];
const INSTRUCTION = "instruction";

// ponytail: where a piece of a run is listed in the section, when it is — its skill, the project rules, how the
// documents fit together, a saved context: the run's card leads there
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
function byGroup(tools: string[]): Fact[] {
  const groups = new Map<string, string[]>();
  for (const t of tools) {
    const [group, ...verb] = t.split("_");
    groups.set(group, [...(groups.get(group) ?? []), verb.join("_") || group]);
  }
  return [...groups].map(([label, verbs]) => ({ label, value: verbs.join(" · ") }));
}

function Part({
  title,
  label = title,
  aside,
  children,
}: {
  title: string;
  /** the part's accessible name, when its title is a piece's own name */
  label?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} {...stylex.props(styles.part)}>
      <div {...stylex.props(styles.head)}>
        <h3 {...stylex.props(type.titleSm, styles.title)}>{title}</h3>
        {aside && <span {...stylex.props(type.small, styles.muted)}>{aside}</span>}
      </div>
      {children}
    </section>
  );
}

const copy = (name: string, text: string) =>
  navigator.clipboard
    .writeText(text)
    .then(() => toast({ tone: "neutral", title: `“${name}” copied` }))
    .catch((e) => errorToast(e, "Could not copy the text"));

// ponytail: one run, as a person asks about it — which screens and commands send it, what Claude is asked (the
// instruction's template, the skill it names), what goes with it (claude.preview for the project's defaults: the very
// pieces the run is sent, each with why and its weight), what it may touch, what it gives back
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
  const list = (label: string, rows: Piece[]) => (
    <PieceList label={label} pieces={rows} total={total} selected={picked} onSelect={setPicked} loading={waiting} />
  );
  return (
    <Card
      title={p.name}
      actions={<Button size="sm" icon="copy" label="Copy" onClick={() => void copy(p.name, p.text)} />}
      footer={
        filled.length > 0 && (
          <p {...stylex.props(type.small, styles.foot)}>
            Built by Testimus for each run: the parts in braces are filled then — {filled.join(", ")}.
          </p>
        )
      }
    >
      <div {...stylex.props(styles.body)}>
        <Facts
          label="When it is sent"
          items={[
            { label: "Sent by", value: p.usedBy.join(" · ") },
            {
              label: "Kind of run",
              value: (
                <>
                  <span {...stylex.props(type.code)}>{p.kind}</span>
                  <span {...stylex.props(styles.muted)}> — it decides the tools and what goes with the run</span>
                </>
              ),
            },
          ]}
        />
        {preview.isError && (
          <Banner tone="danger" compact title="What this run is given could not be read">
            {preview.error.message}
          </Banner>
        )}
        <Part
          title="What Claude is asked"
          aside={
            preview.data &&
            `Claude holds ${tokens(total)} as the run starts: what is said, loaded or read first${
              searched ? `. ${plural(searched, "document")} more to search, never sent whole` : ""
            }.`
          }
        >
          {!preview.isError && list("What Claude is asked", asked)}
          {waiting && <Loading read="claude.preview" />}
        </Part>
        {!preview.isError && (
          <Part
            title="What goes with it"
            aside="With the project's defaults: a request may attach or leave out a piece."
          >
            {list("What goes with it", along)}
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
          </Part>
        )}
        <Part title={shown.name} label="The piece in full" aside={shown.why}>
          <p {...stylex.props(type.code, styles.path)}>
            {[shown.path ?? (shown.kind === INSTRUCTION ? "Built per run — not a file" : ""), shown.detail]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {shown.text !== undefined ? (
            <Raw text={shown.text} label={`Text of ${shown.name}`} maxLines={28} empty="(empty)" />
          ) : (
            <p {...stylex.props(type.small, styles.line, styles.muted)}>
              {shown.kind === "document"
                ? "Claude searches it and reads the passages it finds: it is never sent whole."
                : "It has no text of its own."}
            </p>
          )}
          {entry && listed(entry) && (
            <span>
              <Button variant="link" label="Open it in the list" onClick={() => onOpen(entry)} />
            </span>
          )}
          {shown.kind === "document" && (
            <span>
              <Button
                variant="link"
                label="Open the document"
                onClick={() => app.navigate("documents", shown.id.replace(/^doc:/, ""))}
              />
            </span>
          )}
        </Part>
        <Part title="What it may touch">
          <Facts
            size="sm"
            items={[
              {
                label: "Commands of the app",
                value: p.takes.tools.length
                  ? `${plural(p.takes.tools.length, "command")}, as tools — nothing else of the app can be called`
                  : "None",
              },
              { label: "Claude Code's own tools", value: p.takes.files.join(" · ") || "None" },
            ]}
          />
          {p.takes.tools.length > 0 && (
            <Disclosure quiet summary="The commands it may call" count={p.takes.tools.length}>
              <Facts size="sm" label="The commands it may call" items={byGroup(p.takes.tools)} />
            </Disclosure>
          )}
        </Part>
        {p.answers && (
          <Part title="What it gives back">
            <p {...stylex.props(type.compact, styles.line)}>{p.answers}</p>
          </Part>
        )}
      </div>
    </Card>
  );
}
