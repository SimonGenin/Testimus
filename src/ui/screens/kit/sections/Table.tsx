import { useState } from "react";
import { Badge } from "../../../components/ui/Badge.tsx";
import { Button } from "../../../components/ui/Button.tsx";
import { Table, type TableColumn } from "../../../components/ui/Table.tsx";
import { Cell, type KitSection, States } from "../kit.tsx";

type Space = { id: string; model: string; dims: number; chunks: number; state: "active" | "stale" };
const SPACES: Space[] = [
  { id: "bge", model: "bge-m3", dims: 1024, chunks: 1240, state: "active" },
  { id: "qwen", model: "Qwen3-Embedding-0.6B", dims: 1024, chunks: 980, state: "stale" },
  { id: "q8", model: "bge-m3 · q8", dims: 1024, chunks: 1240, state: "active" },
];

const COLUMNS: TableColumn<Space>[] = [
  { key: "model", label: "Model", sortable: true, width: "45%" },
  { key: "dims", label: "Dims", numeric: true },
  { key: "chunks", label: "Chunks", numeric: true, sortable: true, render: (r) => r.chunks.toLocaleString("en") },
  {
    key: "state",
    label: "State",
    render: (r) =>
      r.state === "active" ? (
        <Badge label="In use" tone="success" icon="check" size="sm" />
      ) : (
        <Badge label="Out of date" tone="warning" icon="clock" size="sm" />
      ),
  },
];

function Sortable() {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" }>({ key: "chunks", dir: "desc" });
  const [selected, setSelected] = useState<string | null>("qwen");
  const rows = [...SPACES].sort((a, b) => {
    const k = sort.key as keyof Space;
    const c = a[k] < b[k] ? -1 : a[k] > b[k] ? 1 : 0;
    return sort.dir === "asc" ? c : -c;
  });
  return (
    <Table
      label="Vector spaces"
      columns={COLUMNS}
      rows={rows}
      getKey={(r) => r.id}
      sort={sort}
      onSort={(key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }))}
      selected={selected}
      onRowSelect={setSelected}
      debugHover="q8"
    />
  );
}

export const section: KitSection = {
  name: "Table",
  family: "Collections",
  file: "Table.tsx",
  summary:
    "Data with several comparable columns: vector spaces, the model catalogue, the push plan. Numbers right-aligned in tabular figures; the head stays on top. A list of things you open is a List, not a table.",
  states: () => (
    <States>
      <Cell label="sortable · selected row · hovered row (first cell opens it)" wide column>
        <Sortable />
      </Cell>
      <Cell label="dense · grid" wide column>
        <Table
          label="Push plan"
          dense
          grid
          columns={[
            { key: "n", label: "#", numeric: true, width: "3rem" },
            { key: "what", label: "Operation" },
            {
              key: "act",
              label: "",
              render: () => <Button iconOnly size="xs" variant="quiet" icon="more" label="Operation actions" />,
            },
          ]}
          rows={[
            { n: 1, what: "Update the summary and labels" },
            { n: 2, what: "Replace step 2" },
          ]}
          getKey={(r) => String(r.n)}
        />
      </Cell>
      <Cell label="loading (skeleton rows)" wide column>
        <Table label="Loading" columns={COLUMNS} rows={[]} getKey={(r) => r.id} loading />
      </Cell>
      <Cell label="empty" wide column>
        <Table
          label="Empty"
          columns={COLUMNS}
          rows={[]}
          getKey={(r) => r.id}
          empty="No vector space yet — index a document first."
        />
      </Cell>
    </States>
  ),
};
