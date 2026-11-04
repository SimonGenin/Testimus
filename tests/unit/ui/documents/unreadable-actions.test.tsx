// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DocDetail } from "../../../../src/ui/screens/documents/DocDetail.tsx";
import { api, FakeEventSource, fakeDesktop, fakeFetch, named, noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { doc, mountDocs } from "./helpers.tsx";

beforeEach(() => {
  fakeFetch();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
  setProject("C:\\p");
});

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  setProject(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const unreadable = () => {
  api.routes["docs.list"] = () => [doc("DX")];
  api.routes["contexts.list"] = () => [];
  return mountDocs(<DocDetail id="DX" anchor="" onAnchor={vi.fn()} onRemoved={vi.fn()} />);
};

const banner = async () =>
  (await screen.findByText("This document could not be opened")).closest("[role]") as HTMLElement;

describe("a document that cannot be opened", () => {
  it("reads it again on « Try again », and opens itself once it can be read", async () => {
    unreadable();
    const retry = within(await banner()).getByRole("button", { name: "Try again" });
    const before = named("docs.show").length;
    api.routes["docs.show"] = () => ({ doc: doc("DX"), context: "", toc: [], figures: [], md: "" });
    fireEvent.click(retry);
    await waitFor(() => expect(named("docs.show").length).toBeGreaterThan(before));
    expect(await screen.findByRole("heading", { name: "Title DX" })).toBeInTheDocument();
    expect(screen.queryByText("This document could not be opened")).toBeNull();
  });

  it("offers to convert it again from its original, and the dialog closes without converting", async () => {
    unreadable();
    fireEvent.click(within(await banner()).getByRole("button", { name: "Convert again" }));
    const dialog = screen.getByRole("dialog", { name: "Convert C-DX again?" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Convert C-DX again?" })).toBeNull();
    expect(named("docs.convert")).toEqual([]);
    fireEvent.click(within(await banner()).getByRole("button", { name: "Convert again" }));
    expect(screen.getByRole("dialog", { name: "Convert C-DX again?" })).toBeInTheDocument();
  });

  it("opens the system check, and shows the document's folder in the desktop app", async () => {
    const desk = fakeDesktop();
    const { app } = unreadable();
    await banner();
    fireEvent.click(screen.getByRole("button", { name: "Open the system check" }));
    expect(app.navigate).toHaveBeenCalledWith("doctor");
    fireEvent.click(screen.getByRole("button", { name: "Show in Explorer" }));
    await waitFor(() => expect(desk.reveal).toHaveBeenCalledWith("C:\\p\\docs\\DX"));
  });
});
