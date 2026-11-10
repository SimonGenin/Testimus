import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { Button } from "../../../components/ui/Button.tsx";
import { type FlowGroup, FlowMap } from "../../../components/ui/FlowMap.tsx";
import { size } from "../../../styles/tokens.stylex.ts";
import { Cell, type KitSection, States } from "../kit.tsx";

const styles = stylex.create({
  tall: { height: size.modalSm, minWidth: 0 },
  narrow: { width: size.dock, maxWidth: "100%" },
});

const said = { icon: "text", word: "Said in full" } as const;
const pointed = { icon: "link", word: "Pointed at" } as const;
const loaded = { icon: "download", word: "Loaded by Claude Code" } as const;
const searched = { icon: "search", word: "Searched" } as const;

// ponytail: a sample node's id and name — the catalogue of screens reads the first name written in this file as the
// section's own, so the samples do not write theirs as a key
const node = (id: string, name: string) => ({ id, name });

const GROUPS: FlowGroup[] = [
  {
    label: "The request",
    nodes: [
      {
        ...node("instruction", "Ask Claude on a test"),
        on: true,
        locked: true,
        icon: "send",
        how: said,
        size: "~420 tokens",
        weight: 1680,
        why: "What Testimus asks of this run, with your request",
        text: "Use the edit-test skill on the test {test}.\n\nRequest: {request}",
      },
      {
        ...node("skill:edit-test", "Edit test"),
        on: true,
        locked: true,
        icon: "layers",
        how: loaded,
        size: "~1.9k tokens",
        weight: 7600,
        why: "The method of the job: the instruction names it",
        detail: ".claude/skills/edit-test/SKILL.md",
      },
      {
        ...node("tools", "14 tools of the app"),
        on: true,
        locked: true,
        icon: "terminal",
        how: loaded,
        why: "What this kind of run may call, and nothing else",
        detail: "Read, Edit, Write, Glob, Grep, Skill, docs_list, rag_search, tests_show, tests_save",
      },
    ],
  },
  {
    label: "Background",
    nodes: [
      {
        ...node("overview", "How the documents fit together"),
        on: true,
        icon: "tree",
        how: pointed,
        why: "Settings › Claude: given to every Claude run",
        detail: "docs/OVERVIEW.md",
      },
    ],
  },
  {
    label: "Contexts",
    nodes: [
      {
        ...node("context:glossaire", "Glossaire RATP"),
        on: true,
        icon: "context",
        how: said,
        size: "~310 tokens",
        weight: 1240,
        why: "A default of the project",
        text: "PCC = poste de commande centralisé\nTK = télécommande",
        actions: <Button size="xs" variant="quiet" label="Edit" />,
      },
      {
        ...node("context:old", "Ancien lot"),
        on: false,
        icon: "context",
        how: pointed,
        size: "~2.4k tokens",
        weight: 9600,
        why: "Saved, not attached to this run",
        detail: "2 files: plan.pdf, ecrans.png",
        actions: <Button size="xs" variant="quiet" label="Edit" />,
      },
    ],
    actions: <Button size="sm" icon="plus" label="New context" />,
  },
  {
    label: "Documents",
    nodes: [
      {
        ...node("doc:D401", "Spécifications fonctionnelles J5"),
        on: true,
        icon: "documents",
        how: searched,
        size: "~48k tokens",
        weight: 192000,
        why: "A document of this run",
        detail: "SOSIE_211_D401-1_3 · v3",
      },
      {
        ...node("docnote:D401", "What the team knows about SOSIE_211_D401-1_3"),
        on: true,
        icon: "quote",
        how: said,
        size: "~60 tokens",
        weight: 240,
        why: "The run is about this document",
        under: true,
        text: "The J5 delivery replaces § 5.6 of the J4 one.",
      },
      {
        ...node("doc:SIG", "Signalisation"),
        on: false,
        icon: "documents",
        how: searched,
        size: "~12k tokens",
        weight: 48000,
        why: "A document of the project: Claude may search it",
      },
    ],
  },
];

const TARGET = {
  title: "Request to Claude",
  total: "7 of 9 pieces · ~2.7k tokens",
  note: "Said, loaded or read first. 1 document more to search, never sent whole.",
};

function Ticked() {
  const [off, setOff] = useState<string[]>(["context:old", "doc:SIG"]);
  const groups = GROUPS.map((g) => ({
    ...g,
    nodes: g.nodes.map((n) => ({ ...n, on: !off.includes(n.id) })),
  }));
  const on = groups.flatMap((g) => g.nodes).filter((n) => n.on).length;
  return (
    <FlowMap
      label="What Claude is given"
      groups={groups}
      target={{ ...TARGET, total: `${on} of 9 pieces` }}
      onToggle={(id, ticked) => setOff(ticked ? off.filter((x) => x !== id) : [...off, id])}
    />
  );
}

export const section: KitSection = {
  name: "FlowMap",
  family: "Claude",
  file: "FlowMap.tsx",
  summary:
    "What flows into one thing, as a graph over a real list: groups of nodes on the left, each a checkbox (or a lock), a link from each to the target on the right — as wide as the node weighs, dashed when it is off.",
  note: "New (asked on 2026-11-10: « show, as a graph, everything injected into a request to Claude »). ReadMap draws where Claude read in one document, Timeline the steps of a job, List rows that are picked: none draws several things joining one, with their weight.",
  guidelines: [
    {
      head: "Anatomy",
      text: "Groups (a caption and « n of m » on) · in a group, one row per node: its checkbox — or a lock when it cannot be unticked here (`locked`: true = it always goes, or the reason) —, its icon and name, why it is there under the name, then how it reaches the target as icon + word (« Said in full », « Pointed at », « Loaded by Claude Code », « Searched ») and its size (« ~1.2k tokens »), then its own actions (Edit) · under the row: one line of detail, and its text folded behind « What … says » · a node `under` the one before it is indented (a document's note under its document) · a group's own actions under its nodes (New context) · the links · the target: icon, title, the total (announced when it changes), a line under it.",
    },
    {
      head: "Rules",
      text: "The graph is decoration (aria-hidden): everything it says is in the list — a node off is an unticked checkbox, a node that always goes a lock whose word is read out. A link's width follows the logarithm of its node's weight, so a note and a whole document still differ at a glance; an off node's link is thin, dashed and muted. Given a height, the list scrolls inside the map and a link whose node is out of sight leaves from the corner it went past. Under 600 px of container the links go and the target sits above the list. Violet is Claude's: the map is drawn for what Claude is given.",
    },
  ],
  states: () => (
    <States>
      <Cell label="what a request to Claude is given · ticking a node redraws its link" wide column>
        <Ticked />
      </Cell>
      <Cell label="given a height: the list scrolls inside, the target stays" wide column>
        <div {...stylex.props(styles.tall)}>
          <FlowMap label="A tall map" groups={GROUPS} target={TARGET} onToggle={() => {}} />
        </div>
      </Cell>
      <Cell label="narrow container (440 px): no links, the target above the list" wide column>
        <div {...stylex.props(styles.narrow)}>
          <FlowMap label="A narrow map" groups={GROUPS.slice(0, 3)} target={TARGET} onToggle={() => {}} />
        </div>
      </Cell>
      <Cell label="read-only (no onToggle) · an empty group says so · nothing ticked for a reason" wide column>
        <FlowMap
          label="A read-only map"
          groups={[
            GROUPS[1],
            { label: "Contexts", nodes: [], empty: "No saved context yet.", actions: GROUPS[2].actions },
          ]}
          target={{ title: "Every run on this document", icon: "documents" }}
        />
        <FlowMap
          label="A map that waits"
          groups={GROUPS.slice(1, 3)}
          target={{ title: "Request to Claude" }}
          onToggle={() => {}}
          disabled="Claude is working — wait for it to finish"
        />
      </Cell>
    </States>
  ),
};
