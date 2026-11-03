// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocJson } from "../../src/core/types.ts";
import { mount } from "./cov-uiscreens-helpers.tsx";

const runs: { name: string; input: Record<string, unknown> }[] = [];

vi.mock("../../src/ui/api.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/ui/api.ts")>();
  return {
    ...real,
    run: vi.fn(async (name: string, input: Record<string, unknown>) => {
      runs.push({ name, input });
      return name === "docs.convert" ? { id: input.id, warnings: ["2 heading numbers are drawn"] } : {};
    }),
    call: vi.fn(async (name: string, input: Record<string, unknown>) => {
      runs.push({ name, input });
      return name === "claude.status" ? { installed: true, signedIn: true } : {};
    }),
  };
});

const { ConvertDoc } = await import("../../src/ui/screens/documents/ConvertDoc.tsx");

const DOC: DocJson = {
  id: "SOSIE_441",
  code: "SOSIE_441",
  title: "TOC",
  version: "01.00",
  date: "",
  kind: "spec",
  status: "draft",
  source: { path: "C:/client/SOSIE_441_01.00.pdf", sha256: "", file: "source.pdf" },
  convertedWith: "pdfjs-dist (tagged PDF)",
  convertedAt: "2026-11-03T00:00:00.000Z",
  warnings: [],
  conversion: {
    reader: "tagged",
    numbers: [
      { number: "1", title: "Généralités" },
      { number: "1.1", title: "Objet" },
    ],
    notes: "Numbers drawn by Word.",
  },
};

beforeEach(() => {
  runs.length = 0;
});
afterEach(cleanup);

describe("Convert again with Claude's study", () => {
  it("shows the options kept from the study and sends study when ticked, without a separate triage", async () => {
    mount(<ConvertDoc doc={DOC} again onClose={() => {}} onChanged={() => {}} />);
    const kept = screen.getByText("Converted from the PDF tags, 2 heading numbers read on the pages.");
    expect(kept).toHaveAttribute("title", "Numbers drawn by Word.");
    const box = screen.getByRole("checkbox", { name: /Claude studies the original first/ });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Convert again and index" }));
    });
    const convert = runs.find((r) => r.name === "docs.convert");
    expect(convert?.input).toMatchObject({ id: "SOSIE_441", study: true });
    await waitFor(() => expect(runs.some((r) => r.name === "rag.index")).toBe(true));
    await act(() => new Promise((r) => setTimeout(r, 20)));
    expect(runs.some((r) => r.name === "actions.triage")).toBe(false);
  });

  it("leaves study out by default", async () => {
    mount(<ConvertDoc doc={{ ...DOC, conversion: undefined }} onChanged={() => {}} />);
    expect(screen.queryByText(/Converted from/)).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Convert and index" }));
    });
    expect(runs.find((r) => r.name === "docs.convert")?.input).not.toHaveProperty("study");
    await waitFor(() => expect(runs.some((r) => r.name === "actions.triage")).toBe(true));
  });
});
