// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PackRow } from "../../../../src/ui/screens/settings/models/data.ts";
import { PackCard } from "../../../../src/ui/screens/settings/models/PackCard.tsx";

afterEach(cleanup);

const pack = (over: Partial<PackRow> = {}): PackRow => ({
  id: "balanced",
  label: "Balanced",
  intent: "Good answers at a fair speed",
  active: true,
  available: true,
  variant: 0,
  embedding: "bge-m3-q8",
  reranker: null,
  fit: null,
  skipped: [],
  downloadMB: 0,
  quality: "Recall 0.71 on the reference document",
  measuredHere: false,
  ...over,
});

const card = (p: PackRow) =>
  render(<PackCard pack={p} label={(x) => x} op={null} busy={false} onUse={vi.fn()} onCancel={vi.fn()} />);

const facts = () => {
  const article = screen.getByRole("article", { name: "Balanced pack" });
  const terms = within(article)
    .getAllByRole("term")
    .map((t) => t.textContent);
  const values = within(article)
    .getAllByRole("definition")
    .map((d) => d.textContent);
  return Object.fromEntries(terms.map((t, i) => [t, values[i]]));
};

describe("Settings › Models: a pack card's quality on this project (audit M-S1)", () => {
  it("shows « On this project » with the quality the project measured, beside the reference quality", () => {
    card(pack({ projectQuality: "Recall 0.82 on 12 behaviors of this project" }));
    expect(facts()).toMatchObject({
      Quality: "Recall 0.71 on the reference document",
      "On this project": "Recall 0.82 on 12 behaviors of this project",
    });
  });

  it("leaves « On this project » out while the project measured nothing", () => {
    card(pack());
    expect(facts()).not.toHaveProperty("On this project");
    expect(facts()).toMatchObject({ Quality: "Recall 0.71 on the reference document" });
  });
});
