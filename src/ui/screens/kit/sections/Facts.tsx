import { Badge } from "../../../components/ui/Badge.tsx";
import { Facts } from "../../../components/ui/Facts.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

export const section: KitSection = {
  name: "Facts",
  family: "Collections",
  file: "Facts.tsx",
  summary:
    "Facts about one thing, as name and value: a model pack, a figure, the Claude program found, a result's numbers. Names muted on the left, values on the right.",
  note: "The design's .kv (shell.mjs): eight screens drew this list with their own gaps and sizes.",
  guidelines: [
    {
      head: "Options",
      text: "`md` (compact text, in a card or a page) · `sm` (small text, a dense meta block). A row that does not apply is left out (`false`).",
    },
  ],
  states: () => (
    <States>
      <Cell label="md" column>
        <Facts
          label="Search pack"
          items={[
            { label: "Embedding", value: "bge-m3 q8" },
            { label: "Reranker", value: "bge-reranker-v2-m3" },
            { label: "On disk", value: "1.4 GB" },
            false,
            { label: "State", value: <Badge label="In use" tone="success" icon="check" size="sm" /> },
          ]}
        />
      </Cell>
      <Cell label="sm" column>
        <Facts
          size="sm"
          items={[
            { label: "Anchor", value: "fig:synoptique-poste" },
            { label: "Size", value: "1280 × 720" },
          ]}
        />
      </Cell>
      <Cell label="divided (a plan, a measure)" column>
        <Facts
          divided
          items={[
            { label: "Download", value: "1.1 GB" },
            { label: "Folder", value: "D:\\Testimus\\models" },
            { label: "Then", value: "Index again: about 4 min" },
          ]}
        />
      </Cell>
    </States>
  ),
};
