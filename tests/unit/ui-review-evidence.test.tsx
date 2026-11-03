// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding } from "../../src/core/types.ts";
import { notAtAnchor, SourcePanel } from "../../src/ui/screens/review/SourcePanel.tsx";

let routes: Record<string, (input: Record<string, unknown>) => unknown> = {};

beforeEach(() => {
  routes = {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      const m = /^\/api\/([^/]+)\/([^/?]+)/.exec(String(url));
      const name = `${m?.[1]}.${m?.[2]}`;
      const input = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : {};
      const h = routes[name];
      if (!h) return new Response(JSON.stringify({ error: `Unknown command ${name}` }), { status: 404 });
      return new Response(JSON.stringify(h(input) ?? null), { status: 200 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const passage = {
  docId: "D1",
  anchor: "§5.2",
  path: "5 > 5.2",
  title: "Sectionneur",
  text: "Le sectionneur est ouvert par l'opérateur depuis le poste.",
  figures: [],
  doc: { code: "D401", version: "3", title: "Spécification", status: "validated" },
};

const evidence = {
  testId: "local-1",
  jobId: "generate-1",
  consulted: ["D1#§5.2", "D1#§5.3"],
  read: [
    { ref: "D1#§5.2", title: "Sectionneur", cited: true },
    { ref: "D1#§5.3", title: "Disjoncteur", cited: false },
  ],
  searched: [{ tool: "rag_search", query: "sectionneur" }],
};

const panel = (props: Partial<Parameters<typeof SourcePanel>[0]> = {}) =>
  render(
    <SourcePanel
      source={{ docId: "D1", anchor: "§5.2", quote: "ouvert par l'opérateur" }}
      label="Source of step 1"
      index={0}
      total={1}
      testId="local-1"
      onClose={vi.fn()}
      onOpenDoc={vi.fn()}
      onPick={vi.fn()}
      {...props}
    />,
  );

describe("Review › sources read", () => {
  it("lists what the generation read and picks one", async () => {
    routes["rag.passage"] = () => passage;
    routes["review.evidence"] = () => evidence;
    const onPick = vi.fn();
    panel({ onPick });
    const block = await screen.findByRole("region", { name: "Sources read" });
    expect(await within(block).findByText("2 read")).toBeInTheDocument();
    const head = within(block).getByRole("button", { name: /Sources read/ });
    expect(head).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(head);
    expect(within(block).getByText("Read by the generation (2)")).toBeInTheDocument();
    expect(within(block).getByText("Cited")).toBeInTheDocument();
    fireEvent.click(within(block).getByRole("button", { name: /D1#§5.3/ }));
    expect(onPick).toHaveBeenCalledWith("D1#§5.3");
  });

  it("shows a clean empty state when nothing was recorded (or the command is not there)", async () => {
    routes["rag.passage"] = () => passage;
    panel();
    const block = await screen.findByRole("region", { name: "Sources read" });
    expect(await within(block).findByText("Not recorded")).toBeInTheDocument();
    fireEvent.click(within(block).getByRole("button", { name: /Sources read/ }));
    expect(within(block).getByText(/not recorded for this test/)).toBeInTheDocument();
  });

  it("says « not recorded » for a test without a ledger", async () => {
    routes["rag.passage"] = () => passage;
    routes["review.evidence"] = () => ({ ...evidence, jobId: null, consulted: [], read: [], searched: [] });
    panel();
    const block = await screen.findByRole("region", { name: "Sources read" });
    fireEvent.click(await within(block).findByRole("button", { name: /Sources read/ }));
    expect(await within(block).findByText(/Not recorded: this test was not written/)).toBeInTheDocument();
    expect(within(block).getByText("Not recorded")).toBeInTheDocument();
  });

  it("highlights the quote only when it is at its anchor", async () => {
    routes["rag.passage"] = () => passage;
    routes["review.evidence"] = () => evidence;
    const { container, unmount } = panel();
    await screen.findByText("ouvert par l'opérateur");
    expect(container.querySelector("mark")).not.toBeNull();
    unmount();
    const finding: Finding = {
      step: 1,
      kind: "quote-not-at-anchor",
      severity: "error",
      message:
        'Step 1: the quote "ouvert par l\'opérateur" is in D1 but not under §5.2: it is under §5.3 — cite D1#§5.3.',
      sources: ["D1#§5.2", "D1#§5.3"],
    };
    const r = panel({ misplaced: finding });
    await screen.findByText(/Le sectionneur est ouvert/);
    expect(r.container.querySelector("mark")).toBeNull();
    expect(screen.getByText("Quote not at this anchor")).toBeInTheDocument();
    expect(screen.getByText(/it is under §5.3/)).toBeInTheDocument();
  });

  it("finds the quote-not-at-anchor finding of the selected source and step", () => {
    const f: Finding = { step: 2, kind: "quote-not-at-anchor", severity: "error", message: "m", sources: ["D1#§5.2"] };
    const other: Finding = { step: 2, kind: "quote-weak", severity: "warning", message: "w", sources: ["D1#§5.2"] };
    expect(notAtAnchor([other, f], "D1#§5.2", 2)).toBe(f);
    expect(notAtAnchor([f], "D1#§5.2", 1)).toBeUndefined();
    expect(notAtAnchor([f], "D1#§5.3", 2)).toBeUndefined();
    expect(notAtAnchor([f], "D1#§5.2", null)).toBe(f);
  });
});

describe("Review › a quote past the cap of a long section (review #16)", () => {
  it("asks rag.passage around the quote, then highlights it", async () => {
    const asked: Record<string, unknown>[] = [];
    routes["rag.passage"] = (input) => {
      asked.push(input);
      return { ...passage, truncated: true, quoteFound: true };
    };
    routes["review.evidence"] = () => evidence;
    const { container } = panel();
    await screen.findByText("ouvert par l'opérateur");
    expect(asked[0]).toEqual({ ref: "D1#§5.2", around: "ouvert par l'opérateur" });
    expect(container.querySelector("mark")).not.toBeNull();
  });

  it("says so, without a highlight, when the section does not hold the quote", async () => {
    routes["rag.passage"] = () => ({ ...passage, quoteFound: false });
    routes["review.evidence"] = () => evidence;
    const { container } = panel({ source: { docId: "D1", anchor: "§5.2", quote: "une phrase ailleurs" } });
    expect(await screen.findByText(/Not highlighted: the quote is not in this section’s own text/)).toBeInTheDocument();
    expect(container.querySelector("mark")).toBeNull();
  });
});
