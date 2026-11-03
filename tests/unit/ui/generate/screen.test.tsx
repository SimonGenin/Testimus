// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reindexAll } from "../../../../src/ui/lib/uploads.ts";
import { GenerateScreen } from "../../../../src/ui/screens/generate/GenerateScreen.tsx";
import { clearToasts, mount } from "../../cov-uiscreens-helpers.tsx";
import { callsOf, deferred, fakeEvents, fakeNet, net } from "../../cov-uishell-helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
  net.routes["jobs.list"] = () => [];
  net.routes["contexts.list"] = () => [];
  net.routes["docs.show"] = () => ({ toc: [] });
});

afterEach(() => {
  cleanup();
  clearToasts();
  vi.unstubAllGlobals();
});

const at = "2026-11-02T10:00:00.000Z";

describe("Generate while an index runs (audit M-G1)", () => {
  it("is disabled while the index it started runs, says Indexing…, and comes back with the documents read again", async () => {
    let built = false;
    net.routes["docs.list"] = () => [
      { id: "D1", code: "D1", title: "Traction", convertedAt: at, indexed: built ? "fresh" : "stale" },
    ];
    const gate = deferred<unknown>();
    net.routes["rag.index"] = async () => {
      await gate.promise;
      built = true;
      return { chunks: 3 };
    };
    mount(<GenerateScreen />);
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("Index not up to date");
    const go = screen.getByRole("button", { name: "Generate" });
    await waitFor(() => expect(go).toBeEnabled());
    fireEvent.click(within(notice).getByRole("button", { name: "Reindex" }));
    await waitFor(() => expect(go).toBeDisabled());
    expect(within(screen.getByRole("status")).getByText(/Indexing…/)).toBeInTheDocument();
    expect(callsOf("rag.index")).toHaveLength(1);
    const listed = callsOf("docs.list").length;
    gate.resolve(null);
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled());
    await waitFor(() => expect(callsOf("docs.list").length).toBeGreaterThan(listed));
    await waitFor(() => expect(screen.queryByText("Index not up to date")).toBeNull());
  });

  it("is disabled too while an index started from another screen runs", async () => {
    net.routes["docs.list"] = () => [{ id: "D1", code: "D1", title: "Traction", convertedAt: at, indexed: "fresh" }];
    const gate = deferred<unknown>();
    net.routes["rag.index"] = async () => {
      await gate.promise;
      return { chunks: 3 };
    };
    const started = reindexAll(() => {});
    mount(<GenerateScreen />);
    await screen.findByText("Traction");
    fireEvent.change(screen.getByLabelText("What should be tested?"), { target: { value: "x" } });
    expect(screen.getByRole("button", { name: "Generate" })).toBeDisabled();
    gate.resolve(null);
    await started;
    await waitFor(() => expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled());
  });
});
