// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DocDetail } from "../../../../src/ui/screens/documents/DocDetail.tsx";
import { api, FakeEventSource, fakeFetch, named } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { at, doc, mountDocs, refuse } from "./helpers.tsx";

beforeEach(() => {
  fakeFetch();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  clearToasts();
  setProject(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const figures = [
  { file: "figures/a.png", anchor: "fig:a", caption: "Plan", description: "" },
  { file: "figures/b.png", anchor: "fig:b", caption: "Coupe", description: "" },
];

const show = () => {
  api.routes["docs.show"] = (i) =>
    i.anchor ? { md: `Part ${i.anchor}` } : { doc: doc("D1"), context: "", toc: [], figures, md: "" };
  api.routes["contexts.list"] = () => [];
  mountDocs(<DocDetail id="D1" anchor="" onAnchor={vi.fn()} onRemoved={vi.fn()} />);
};

const clipboard = (writeText: (s: string) => Promise<void>) =>
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

const copyId = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "More actions for this document" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Copy the document id" }));
};

describe("the document's head and its figures", () => {
  it("copies the document id, and a refused clipboard breaks nothing", async () => {
    const write = vi.fn(async (_s: string) => {});
    clipboard(write);
    show();
    await copyId();
    expect(write).toHaveBeenCalledWith("D1");
    const refused = vi.fn(async (_s: string) => {
      throw new Error("denied");
    });
    clipboard(refused);
    await copyId();
    await waitFor(() => expect(refused).toHaveBeenCalledWith("D1"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("heading", { name: "Title D1" })).toBeInTheDocument();
  });

  it("while Claude describes this document's figures, Describe waits for it", async () => {
    setProject("C:\\p");
    api.routes["jobs.list"] = () => [
      { id: "df-1", kind: "describe-figures", subject: "D2", status: "running", startedAt: at },
      { id: "df-2", kind: "describe-figures", subject: "D1", status: "running", startedAt: at },
    ];
    show();
    fireEvent.click(await screen.findByRole("tab", { name: /^Figures/ }));
    const busy = await screen.findByRole("button", { name: /Claude is describing…/ });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "Describe 2 figures" })).toBeNull();
    fireEvent.click(busy);
    expect(named("docs.describeFigures")).toEqual([]);
  });

  it("says when Claude could not be asked to describe the figures", async () => {
    show();
    refuse("docs.describeFigures", () => true, { error: "Claude is not signed in" });
    fireEvent.click(await screen.findByRole("tab", { name: /^Figures/ }));
    fireEvent.click(screen.getByRole("button", { name: "Describe 2 figures" }));
    expect(await screen.findByText("Could not ask Claude to describe the figures")).toBeInTheDocument();
    expect(screen.getByText("Claude is not signed in")).toBeInTheDocument();
    expect(named("docs.describeFigures")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Describe 2 figures" })).toBeEnabled();
  });
});
