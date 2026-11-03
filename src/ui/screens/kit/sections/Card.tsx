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
  note: "radio is the « radio card » the screens drew for packs and drives: the card stays a Card, the choice adds a native radio, the whole card picks it, and the arrows move between the cards of one name.",
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
      <Cell label="radio · checked, hover, disabled" wide column>
        <Packs />
      </Cell>
      <Cell label="radio focus" column>
        <Drive />
      </Cell>
    </States>
  ),
};
