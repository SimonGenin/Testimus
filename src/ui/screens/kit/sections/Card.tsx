import * as stylex from "@stylexjs/stylex";
import { useId, useState } from "react";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Card } from "../../../components/ui/Card.tsx";
import { List } from "../../../components/ui/List.tsx";
import { space } from "../../../styles/tokens.stylex.ts";
import { Cell, type KitSection, States } from "../kit.tsx";

const styles = stylex.create({ group: { display: "flex", flexDirection: "column", gap: space.s3 } });

const PACKS = [
  { id: "light", title: "Light", text: "bge-m3 q8 · 0.6 GB — runs on any PC." },
  { id: "balanced", title: "Balanced", text: "bge-m3 + reranker · 1.4 GB." },
  { id: "heavy", title: "Heavy", text: "Qwen3 + reranker · 3.1 GB — needs 16 GB of memory." },
];

function Packs() {
  const [pack, setPack] = useState("light");
  const name = useId();
  return (
    <div role="radiogroup" aria-label="Search packs" {...stylex.props(styles.group)}>
      {PACKS.map((p) => (
        <Card
          key={p.id}
          title={p.title}
          actions={p.id === "light" ? <Badge label="In use" tone="success" icon="check" size="sm" /> : undefined}
          radio={{ name, value: p.id, checked: pack === p.id, onSelect: setPack, disabled: p.id === "heavy" }}
          debugState={p.id === "balanced" ? "hover" : undefined}
        >
          {p.text}
        </Card>
      ))}
    </div>
  );
}

function Drive() {
  const name = useId();
  return (
    <Card title="D:" radio={{ name, value: "d", checked: false, onSelect: () => {} }} debugState="focus">
      212 GB free
    </Card>
  );
}

export const section: KitSection = {
  name: "Card",
  family: "Layout",
  file: "Card.tsx",
  summary:
    "A framed group with a head (title, actions), a body and a foot: settings sections, model packs, the push plan's operations, a finding, the step card. A state is a badge in the head, never a coloured edge; cards nest once at most.",
  note: "density compact (12/16 px) is a card among many (a finding, a radio card in a list, a figure's detail), tight (8 px) a tile in a grid; fill makes the cards of a grid row as tall as each other. radio is the « radio card » the screens drew for packs and drives: the card stays a Card, the choice adds a native radio, the whole card picks it, and the arrows move between the cards of one name.",
  guidelines: [],
  states: () => (
    <States>
      <Cell label="title · actions · body · foot" column>
        <Card
          title="Claude dock"
          actions={<Button size="sm" variant="quiet" label="Reset" />}
          footer={<Button size="sm" label="Manage contexts…" />}
        >
          The model and effort new runs start with.
        </Card>
      </Cell>
      <Cell label="density compact (a finding, a figure's detail) · tight (a figure's tile)" column>
        <Card density="compact" title="Unsupported" actions={<Badge label="Error" tone="danger" size="sm" />}>
          Le §5.6.6 ne dit pas que le menu s'ouvre sur la vue de traction.
        </Card>
        <Card density="tight" label="Figure 40" onOpen={() => {}}>
          Figure 40 · fig:40
        </Card>
      </Cell>
      <Cell label="fill: cards of one row as tall as each other" wide>
        <Card fill title="Light" footer={<Button size="sm" label="Use" />}>
          bge-m3 q8.
        </Card>
        <Card fill title="Balanced" footer={<Button size="sm" label="Use" />}>
          bge-m3 + reranker · 1.4 GB — the default for a PC with 16 GB of memory.
        </Card>
      </Cell>
      <Cell label="selected" column>
        <Card title="Step 2" selected>
          Ouvrir le menu contextuel du sectionneur.
        </Card>
      </Cell>
      <Cell label="no title · flush body" column>
        <Card padded={false}>
          <List
            label="Known projects"
            items={["RATP", "LFRPS12"]}
            getKey={(k) => k}
            renderItem={(k) => ({ title: k })}
            divided
          />
        </Card>
      </Cell>
      <Cell label="focused · edges (warning, success, claude, danger)" wide column>
        <Card title="Step 1" focused>
          Ouvrir le menu contextuel.
        </Card>
        <Card title="Step 2" edge="warning">
          Modified.
        </Card>
        <Card title="Step 3" edge="success">
          New.
        </Card>
        <Card title="Step 4" edge="claude">
          Changed by Claude.
        </Card>
        <Card title="Step 5" edge="danger">
          Unreadable.
        </Card>
      </Cell>
      <Cell label="dashed (a place for what is not there yet)" column>
        <Card dashed>Claude is writing step 4…</Card>
      </Cell>
      <Cell label="dashed · danger edge (a step Jira has and the test no longer does)" column>
        <Card dashed edge="danger">
          Step 3 in Jira — « Ouvrir le menu »
        </Card>
      </Cell>
      <Cell label="onOpen · rest, hover, focus" wide column>
        <Card title="Figure 3" onOpen={() => {}}>
          Synoptique du poste.
        </Card>
        <Card title="Figure 4" onOpen={() => {}} debugState="hover">
          Menu contextuel.
        </Card>
        <Card title="Figure 5" onOpen={() => {}} debugState="focus">
          Légende.
        </Card>
      </Cell>
      <Cell label="radio · checked, hover, disabled" wide column>
        <Packs />
      </Cell>
      <Cell label="radio focus" column>
        <Drive />
      </Cell>
    </States>
  ),
};
