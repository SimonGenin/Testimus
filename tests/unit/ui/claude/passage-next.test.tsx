// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Passage } from "../../../../src/core/types.ts";
import { PassageDialog } from "../../../../src/ui/components/sources/PassageDialog.tsx";
import { callsOf, fakeEvents, fakeNet, net, renderWithData } from "../../helpers/ui-data.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const passage = (anchor: string): Passage => ({
  docId: "D",
  anchor,
  path: "Ch 1",
  title: `Titre ${anchor}`,
  text: "Le menu ne propose que Propriétés.",
  figures: [],
  doc: { code: "SOSIE_211", title: "Spécification", version: "3", status: "validated" },
});

describe("Passage dialog › Next source", () => {
  it("goes from the step's first source to the next one and opens that one in its document", async () => {
    net.routes["rag.passage"] = (i) => passage(String(i.ref).split("#")[1]);
    const a = { docId: "D", anchor: "§1", quote: "Propriétés" };
    const b = { docId: "D", anchor: "§2", quote: "menu" };
    const open = vi.fn();
    renderWithData(
      <PassageDialog
        source={a}
        from={{ test: "LFRPS12-1420", step: 3, sources: [a, b] }}
        onClose={() => {}}
        onOpenDoc={open}
      />,
    );
    expect(screen.getByText("1 of 2 sources")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous source" })).toBeDisabled();
    expect(await screen.findByRole("heading", { name: "§ 1 Titre §1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next source" }));
    expect(screen.getByText("2 of 2 sources")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next source" })).toBeDisabled();
    expect(await screen.findByRole("heading", { name: "§ 2 Titre §2" })).toBeInTheDocument();
    await waitFor(() => expect(callsOf("rag.passage").map((c) => c.input.ref)).toEqual(["D#§1", "D#§2"]));
    fireEvent.click(screen.getByRole("button", { name: /Open in document/ }));
    expect(open).toHaveBeenCalledWith("D", "§2", "menu", { test: "LFRPS12-1420", step: 3 });
  });
});
