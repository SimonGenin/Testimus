// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Test } from "../../../../src/core/types.ts";
import { ReviewScreen } from "../../../../src/ui/screens/review/ReviewScreen.tsx";
import { clearToasts, fakeServer, mountReview, named, net } from "./helpers.tsx";

beforeEach(() => {
  fakeServer();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  clearToasts();
  vi.unstubAllGlobals();
});

const test1420: Test = {
  key: "LFRPS12-1420",
  project: "LFRPS12",
  summary: "Sectionneur sans TK — menu contextuel",
  folder: "/Traction/Sectionneurs",
  labels: [],
  description: "",
  covers: [],
  preconditions: [],
  review: "draft",
  steps: [
    {
      fields: { Action: "Ouvrir la vue de traction.", "Expected Result": "La vue s'affiche." },
      sources: [{ docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6", quote: "Selon le type de sectionneur" }],
      images: [],
    },
    {
      fields: {
        Action: "Clic droit sur le sectionneur S 12.",
        "Expected Result": "Le menu propose Propriétés.",
        Exigence: "EXI_MOP_SPF_511_A_1670, EXI_MOP_SPF_510_A_20",
      },
      sources: [{ docId: "SOSIE_211_D401-1_3", anchor: "§5.6.6", quote: "Selon le type de sectionneur" }],
      images: [],
    },
  ],
  extra: {},
};

const queued = (id: string, over: Record<string, unknown>) => ({
  id,
  summary: test1420.summary,
  folder: "/Traction/Sectionneurs",
  review: "draft",
  unchecked: false,
  errors: 0,
  warnings: 0,
  infos: 0,
  stale: false,
  mtime: 1,
  ...over,
});

function routes() {
  net.routes["review.queue"] = () => ({
    tests: [
      queued("LFRPS12-1420", { key: "LFRPS12-1420", errors: 1, warnings: 1 }),
      queued("local-3f9a12c0", {
        summary: "Sectionneur avec TK — manœuvre régulière",
        review: "to-fix",
        unchecked: true,
        mtime: 2,
      }),
    ],
    counts: { toFix: 1, draft: 1, unchecked: 1 },
  });
  net.routes["tests.show"] = (i) => ({ id: i.id, test: test1420, sync: "synced", edited: false });
  net.routes["check.show"] = (i) => ({
    id: i.id,
    stale: false,
    check: {
      at: "2026-10-30T10:02:00.000Z",
      testHash: "x",
      findings: [
        {
          kind: "negative-missing",
          severity: "warning",
          message: "Aucun step ne vérifie le cas avec TK.",
          sources: ["SOSIE_211_D401-1_3#§5.6.6"],
        },
        {
          step: 2,
          kind: "contradicted",
          severity: "error",
          message: "Le passage porte sur le TCO à deux rangs.",
          sources: ["SOSIE_211_D401-1_3#§5.6.6"],
        },
      ],
    },
  });
  net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
  net.routes["rag.passage"] = (i) => ({
    docId: "SOSIE_211_D401-1_3",
    anchor: String(i.ref).split("#")[1],
    path: "5 > 5.6 > 5.6.6",
    title: "Sectionneur (S)",
    text: "Selon le type de sectionneur, le menu contextuel diffère.",
    figures: [],
    doc: { code: "SOSIE_211_D401-1_3", title: "Traction", version: "01.01", status: "validated" },
  });
  net.routes["review.set"] = (i) => ({ id: i.id, review: i.decision === "validate" ? "validated" : "to-fix" });
}

describe("Review screen on the sample project", () => {
  it("renders the queue, places findings on their step and validates with V", async () => {
    routes();
    const { app } = mountReview(<ReviewScreen />, { route: { screen: "review" } });
    const queue = await screen.findByRole("complementary", { name: "Review queue" });
    const list = await within(queue).findByRole("listbox", { name: "Queue tests in /Traction/Sectionneurs" });
    await waitFor(() =>
      expect(within(list).getAllByRole("option", { name: /^Sectionneur (sans|avec)/ })).toHaveLength(2),
    );
    expect(
      within(within(queue).getByRole("tree", { name: "Queue folders" })).getByRole("treeitem", {
        name: /^Sectionneurs/,
      }),
    ).toHaveAttribute("aria-selected", "true");
    expect(within(list).getAllByRole("tooltip", { hidden: true })[1]).toHaveTextContent(/^Not in Jira yet/);
    expect(within(list).getByText("Not checked yet")).toBeInTheDocument();

    const step2 = await screen.findByRole("article", { name: "Step 2" });
    expect(within(step2).getByRole("note", { name: "Error · Contradicted" })).toBeInTheDocument();
    expect(screen.getByText("Whole test")).toBeInTheDocument();
    expect(await screen.findByText("Finding on step 2 · Contradicted")).toBeInTheDocument();
    await waitFor(() => expect(named("rag.passage").length).toBeGreaterThan(0));
    expect(named("rag.passage")[0].input.ref).toBe("SOSIE_211_D401-1_3#§5.6.6");
    expect(step2).toHaveAttribute("aria-current", "step");
    fireEvent.click(screen.getByRole("button", { name: "Close the source panel" }));
    expect(screen.queryByRole("complementary", { name: "Source passage" })).toBeNull();
    fireEvent.click(within(step2).getAllByRole("button", { name: /§5\.6\.6/ })[0]);
    expect(await screen.findByText("Source of step 2")).toBeInTheDocument();
    expect(screen.getByRole("tooltip", { hidden: true, name: "1 error still open" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "v" });
    await waitFor(() => expect(named("review.set")).toHaveLength(1));
    expect(named("review.set")[0].input).toEqual({ id: "LFRPS12-1420", decision: "validate" });
    await waitFor(() => expect(app.navigate).toHaveBeenCalledWith("review", "local-3f9a12c0"));
  });

  it("asks for a note before marking To fix, then hands the fix to Claude", async () => {
    routes();
    const { app } = mountReview(<ReviewScreen />, { route: { screen: "review" } });
    await screen.findByRole("article", { name: "Step 2" });
    const dialog = await waitFor(() => {
      if (!screen.queryByRole("dialog", { name: "What needs fixing?" })) fireEvent.keyDown(window, { key: "f" });
      return screen.getByRole("dialog", { name: "What needs fixing?" });
    });
    expect(screen.getByRole("button", { name: /^Validate(?!d)/ })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Ask Claude to fix it" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Ask Claude to fix it" })).toHaveAccessibleDescription(
      /Write the note first/,
    );
    expect(within(dialog).getByLabelText(/Note for the author/)).toHaveAttribute(
      "placeholder",
      "Say what is wrong, and what the test should check instead…",
    );
    fireEvent.click(within(dialog).getByRole("button", { name: /Mark To fix/ }));
    expect(within(dialog).getByLabelText(/Note for the author/)).toHaveAccessibleDescription(/note is required/);
    expect(app.runInDock).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText(/Note for the author/), {
      target: { value: "Retirer EXI_MOP_SPF_510_A_20 du step 2." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Ask Claude to fix it" }));
    await waitFor(() =>
      expect(app.runInDock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "review.fix",
          testId: "LFRPS12-1420",
          input: { id: "LFRPS12-1420", note: "Retirer EXI_MOP_SPF_510_A_20 du step 2." },
        }),
      ),
    );
    expect(named("review.set")).toHaveLength(0);
  });
});
