// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { changesLine, overviewMeta, updatedLine } from "../../../../src/ui/lib/overview.ts";
import { DocumentsScreen } from "../../../../src/ui/screens/documents/DocumentsScreen.tsx";
import { api, FakeEventSource, fakeFetch, named, noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { doc, mountDocs, startsJob } from "./helpers.tsx";

beforeEach(() => {
  fakeFetch();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  setProject(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const TEXT = [
  "## Traction <!-- doc D1 -->",
  "",
  'La **traction** : manœuvre des sectionneurs [D1#§5.6 "La manœuvre des sectionneurs"].',
  "",
  "## Ce qui se contredit",
  "",
  "Rien de relevé.",
  "",
].join("\n");

const shown = (over: Record<string, unknown> = {}) => ({
  enabled: true,
  inEveryRun: true,
  exists: true,
  path: "docs/OVERVIEW.md",
  text: TEXT,
  mtime: 1000,
  updatedAt: "2026-11-08T11:02:00.000Z",
  updatedAfter: "Import of 3 documents",
  kind: "import",
  changed: { modified: ["Signalisation", "Ce qui se contredit"], added: ["Poste de commande"], removed: [] },
  pending: [],
  last: { at: "2026-11-08T11:02:00.000Z", before: "## A\n\nold line\n", after: "## A\n\nnew line\n" },
  ...over,
});

function mount(over: Record<string, unknown> = {}) {
  api.routes["docs.list"] = () => [doc("D1"), doc("D2")];
  api.routes["rag.status"] = () => ({ exists: true, degraded: null });
  api.routes["docs.overviewShow"] = () => shown(over);
  return mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "~overview" } });
}

const pane = () => screen.getByRole("region", { name: "How the documents fit together" });

describe("How the documents fit together", () => {
  it("heads the document list, by Claude, and opens from it", async () => {
    api.routes["docs.list"] = () => [doc("D1"), doc("D2")];
    api.routes["rag.status"] = () => ({ exists: true, degraded: null });
    api.routes["docs.overviewShow"] = () => shown();
    const m = mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "D2" } });
    const list = await screen.findByRole("region", { name: "Document list" });
    const row = await within(list).findByRole("option", { name: /How the documents fit together/ });
    expect(row).toHaveTextContent("By Claude");
    expect(row).toHaveTextContent("updated after the last import");
    expect(within(list).getAllByRole("option")[0]).toBe(row);
    fireEvent.click(row);
    expect(m.app.navigate).toHaveBeenCalledWith("documents", "~overview");
  });

  it("shows the text as elements, the switch, and what the last update changed with its diff", async () => {
    mount();
    await waitFor(() => expect(pane()).toBeInTheDocument());
    expect(within(pane()).getByRole("heading", { level: 2, name: "Traction" })).toBeInTheDocument();
    const para = within(pane()).getByText(
      (_, el) => el?.tagName === "P" && /^La traction : manœuvre des sectionneurs/.test(el.textContent ?? ""),
    );
    expect(within(para).getByText("traction").tagName).toBe("STRONG");
    expect(pane().textContent).not.toContain("<!--");
    expect(pane().textContent).not.toContain("**");
    expect(within(pane()).getByText(/after « Import of 3 documents »/)).toBeInTheDocument();
    expect(within(pane()).getByRole("switch", { name: "Give it to every Claude run" })).toBeChecked();
    expect(
      within(pane()).getByText(
        "Last update changed 2 sections (« Signalisation », « Ce qui se contredit ») and added 1 (« Poste de commande »). The rest was kept as it was.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(pane()).getByRole("button", { name: "Show changes" }));
    const diff = await screen.findByRole("list", { name: "Changes of the last update" });
    expect(within(diff).getByRole("img", { name: "Removed" }).closest("li")).toHaveTextContent("old line");
    expect(within(diff).getByRole("img", { name: "Added" }).closest("li")).toHaveTextContent("new line");
  });

  it("updates now, rewrites from scratch after a confirmation, and gives it to runs or not", async () => {
    api.routes["docs.overview"] = startsJob("job-o", "docs.overview", "auto", { status: "done" });
    api.routes["project.set"] = () => ({});
    mount();
    await waitFor(() => expect(pane()).toBeInTheDocument());
    fireEvent.click(within(pane()).getByRole("button", { name: "Update now" }));
    await waitFor(() => expect(named("docs.overview")[0]?.input).toEqual({ mode: "auto" }));
    fireEvent.click(within(pane()).getByRole("button", { name: "More" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Rewrite from scratch/ }));
    const ask = await screen.findByRole("alertdialog", { name: "Rewrite it from scratch?" });
    fireEvent.click(within(ask).getByRole("button", { name: "Rewrite" }));
    await waitFor(() => expect(named("docs.overview")[1]?.input).toEqual({ mode: "full" }));
    fireEvent.click(within(pane()).getByRole("switch", { name: "Give it to every Claude run" }));
    await waitFor(() =>
      expect(named("project.set")[0]?.input).toEqual({ claude: { overview: { enabled: true, inEveryRun: false } } }),
    );
  });

  it("is edited by hand and saved against the version it was read at", async () => {
    api.routes["docs.overviewSave"] = () => ({ mtime: 2000 });
    mount();
    await waitFor(() => expect(pane()).toBeInTheDocument());
    fireEvent.click(within(pane()).getByRole("button", { name: "Edit" }));
    const field = within(pane()).getByRole("textbox", { name: "The text, in markdown" });
    fireEvent.change(field, { target: { value: `${TEXT}Ajouté à la main.\n` } });
    fireEvent.blur(field);
    await waitFor(() =>
      expect(named("docs.overviewSave")[0]?.input).toEqual({ text: `${TEXT}Ajouté à la main.\n`, ifMtime: 1000 }),
    );
  });

  it("off: says so and turns on; not written yet: Claude writes it", async () => {
    api.routes["project.set"] = () => ({});
    mount({ enabled: false, inEveryRun: false });
    await waitFor(() => expect(pane()).toBeInTheDocument());
    expect(within(pane()).getByText(/Off for this project/)).toBeInTheDocument();
    expect(within(pane()).queryByRole("button", { name: "Update now" })).toBeNull();
    expect(within(pane()).getByRole("switch", { name: "Give it to every Claude run" })).toBeDisabled();
    fireEvent.click(within(pane()).getByRole("button", { name: "Turn on" }));
    await waitFor(() =>
      expect(named("project.set")[0]?.input).toEqual({ claude: { overview: { enabled: true, inEveryRun: true } } }),
    );
    cleanup();
    api.routes["docs.overview"] = startsJob("job-w", "docs.overview", "full");
    mount({ exists: false, text: "", updatedAt: undefined, last: null });
    fireEvent.click(await screen.findByRole("button", { name: "Write it now" }));
    await waitFor(() => expect(named("docs.overview").at(-1)?.input).toEqual({ mode: "full" }));
  });
});

describe("the words of the overview", () => {
  it("names the sections an update touched, the time and what it came after, and the row's state", () => {
    expect(changesLine({ modified: [], added: [], removed: [] })).toBe("Last update changed no section.");
    expect(changesLine({ modified: [], added: ["A", "B", "C", "D", "E"], removed: ["Z"] })).toBe(
      "Last update added 5 sections (« A », « B », « C » and 2 more) and removed 1 (« Z »). The rest was kept as it was.",
    );
    expect(updatedLine({})).toBe("written by Claude, yours to edit");
    expect(updatedLine({ updatedAt: "2026-11-08T11:02:00", updatedAfter: "Conversion of « Traction »" })).toBe(
      "written by Claude, yours to edit · last updated 8 Nov 11:02, after « Conversion of « Traction » »",
    );
    const o = shown() as Parameters<typeof overviewMeta>[0];
    expect(overviewMeta({ ...o, enabled: false, exists: false })).toBe("Off · Claude can write it");
    expect(overviewMeta({ ...o, pending: [{ id: "D", change: "added", title: "D" }] })).toBe(
      "1 document changed since",
    );
    expect(overviewMeta({ ...o, updatedAfter: undefined })).toBe("written by hand");
    expect(overviewMeta({ ...o, kind: "rewrite" })).toBe("rewritten from scratch");
    expect(overviewMeta({ ...o, kind: "import", updatedAfter: "Import de 3 documents" })).toBe(
      "updated after the last import",
    );
    expect(overviewMeta({ ...o, kind: undefined, updatedAfter: "A rewrite from scratch" })).toBe("updated");
  });
});
