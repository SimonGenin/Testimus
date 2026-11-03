// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Table, type TableProps } from "../../../../src/ui/components/ui/Table.tsx";

afterEach(cleanup);

type R = { id: string; name: string; chunks: number };
const ROWS: R[] = [
  { id: "bge", name: "bge-m3", chunks: 1240 },
  { id: "qwen", name: "Qwen3-Embedding", chunks: 980 },
];
const COLS: TableProps<R>["columns"] = [
  { key: "name", label: "Space", sortable: true, width: "60%" },
  { key: "chunks", label: "Chunks", numeric: true, sortable: true, render: (r) => r.chunks.toLocaleString("en") },
];

const cls = (el: Element) => el.getAttribute("class") ?? "";

function Spaces(p: Partial<TableProps<R>>) {
  return <Table label="Vector spaces" columns={COLS} rows={ROWS} getKey={(r) => r.id} {...p} />;
}

describe("Table", () => {
  it("is a table named by its label, with column heads and the cells of each row", () => {
    render(<Spaces />);
    const t = screen.getByRole("table", { name: "Vector spaces" });
    expect(
      within(t)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["Space", "Chunks"]);
    const rows = within(t).getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(
      within(rows[1])
        .getAllByRole("cell")
        .map((c) => c.textContent),
    ).toEqual(["bge-m3", "1,240"]);
    expect(within(t).getAllByRole("columnheader")[0].style.width).toBe("60%");
  });

  it("right-aligns numeric columns and draws dense and grid cells differently", () => {
    render(
      <>
        <Spaces />
        <Spaces label="dense" dense />
        <Spaces label="grid" grid />
      </>,
    );
    const first = (name: string) => within(screen.getByRole("table", { name })).getAllByRole("cell");
    const plain = first("Vector spaces");
    expect(cls(plain[0])).not.toBe(cls(plain[1]));
    const looks = new Set([cls(plain[0]), cls(first("dense")[0]), cls(first("grid")[0])]);
    expect(looks.size).toBe(3);
  });

  it("sorts from a head button and says which way", () => {
    const onSort = vi.fn();
    const { rerender } = render(<Spaces onSort={onSort} />);
    fireEvent.click(screen.getByRole("button", { name: "Chunks" }));
    expect(onSort).toHaveBeenCalledWith("chunks");
    rerender(<Spaces onSort={onSort} sort={{ key: "chunks", dir: "desc" }} />);
    expect(screen.getByRole("columnheader", { name: "Chunks" })).toHaveAttribute("aria-sort", "descending");
    rerender(<Spaces onSort={onSort} sort={{ key: "name", dir: "asc" }} />);
    expect(screen.getByRole("columnheader", { name: "Space" })).toHaveAttribute("aria-sort", "ascending");
    expect(screen.getByRole("columnheader", { name: "Chunks" })).not.toHaveAttribute("aria-sort");
  });

  it("opens a row from the button in its first cell or a click anywhere on it, and marks the open one", () => {
    const onRowSelect = vi.fn();
    render(<Spaces onRowSelect={onRowSelect} selected="qwen" debugHover="bge" />);
    fireEvent.click(screen.getByRole("button", { name: "bge-m3" }));
    fireEvent.click(screen.getByRole("cell", { name: "980" }));
    expect(onRowSelect.mock.calls.map((c) => c[0])).toEqual(["bge", "qwen"]);
    const [, bge, qwen] = screen.getAllByRole("row");
    expect(qwen).toHaveAttribute("aria-current", "true");
    expect(bge).not.toHaveAttribute("aria-current");
    expect(cls(bge)).not.toBe(cls(qwen));
  });

  it("shows skeleton rows while loading and one message row when empty", () => {
    const { rerender } = render(<Spaces loading />);
    const t = screen.getByRole("table");
    expect(t).toHaveAttribute("aria-busy", "true");
    expect(within(t).queryByText("bge-m3")).toBeNull();
    expect(within(t).getAllByRole("row")).toHaveLength(4);
    rerender(<Spaces rows={[]} empty="No vector space yet." fill />);
    expect(screen.getByRole("cell", { name: "No vector space yet." })).toHaveAttribute("colspan", "2");
    rerender(<Spaces rows={[]} />);
    expect(screen.getByRole("cell", { name: "Nothing to show." })).toBeInTheDocument();
  });
});
