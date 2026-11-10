// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StepColumn } from "../../../../src/core/types.ts";
import { ColumnsClaude } from "../../../../src/ui/screens/settings/ColumnsClaude.tsx";
import { piece, previewOf } from "../../helpers/fake-preview.ts";
import { iconsIn } from "../../helpers/icons.ts";
import { calls, DIR, emit, Fail, fakeJob, fakeNet, info, inputs, mountSettings, net, reset } from "./helpers.tsx";

beforeEach(() => {
  fakeNet();
  net.routes["contexts.list"] = () => [];
  net.routes["project.info"] = () => info();
});

afterEach(reset);

const col = (o: Partial<StepColumn>): StepColumn => ({
  name: "Action",
  origin: "xray",
  builtin: true,
  status: "ok",
  description: "",
  mode: "open",
  ...o,
});

const COLUMNS = [
  col({ name: "Expected Result", description: "Ce que voit l'opérateur." }),
  col({ name: "Écran", builtin: false, description: "" }),
  col({ name: "Remarque", origin: "local", builtin: false, description: "Une remarque." }),
];

const PROPOSALS = [
  {
    name: "Expected Result",
    kind: "xray",
    builtin: true,
    current: "Ce que voit l'opérateur.",
    description: "Une observation par ligne.",
    why: "LFRPS12-1420 le fait.",
  },
  { name: "Écran", kind: "xray", builtin: false, current: "", description: "La fenêtre où se fait le geste.", why: "" },
  { name: "Remarque", kind: "local", builtin: false, current: "Une remarque.", description: "", why: "r" },
  { name: "Poste", kind: "new", builtin: false, current: null, description: "Le poste.", why: "§ 5.6" },
];

let n = 0;
// ponytail: columns.suggest is a job; here it has already ended with this result when the page asks for it
function answers(result: Record<string, unknown>) {
  const id = `columns-${String(++n).padStart(8, "0")}`;
  fakeJob({ id, kind: "columns", status: "done", result });
  net.routes["columns.suggest"] = () => ({ jobId: id });
}

const mount = () => mountSettings(<ColumnsClaude columns={COLUMNS} />);
const ask = () => screen.getByRole("button", { name: /Ask Claude|Ask again|Claude is looking/ });

describe("Settings › Smart columns › Ask Claude", () => {
  it("runs columns.suggest as a job, shows what Claude reads, then its proposals", async () => {
    const j = fakeJob({ id: "columns-c0000001", kind: "columns" });
    net.routes["columns.suggest"] = () => ({ jobId: j.id });
    mount();
    fireEvent.change(screen.getByPlaceholderText(/What the columns should hold/), {
      target: { value: "  le poste  " },
    });
    expect(iconsIn(ask()), "audit icons 107: the send of a Claude block").toEqual(["send"]);
    fireEvent.click(ask());
    expect(await screen.findByText(/Claude is reading the columns/)).toBeInTheDocument();
    await waitFor(() => expect(calls("jobs.show")).toHaveLength(1));
    expect(inputs("columns.suggest")[0]).toEqual({ ask: "le poste" });
    await emit({
      jobId: j.id,
      at: "",
      type: "claude",
      event: { type: "tool", name: "mcp__testimus__rag_search", input: '{"query":"poste"}' },
    } as never);
    expect(screen.getByText(/Searched the documents for “poste”/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(inputs("jobs.cancel")[0]).toEqual({ id: j.id }));
    await j.finish({
      status: "done",
      result: { ok: true, summary: "J'ai lu les tests.\n\n```columns\n{}\n```", proposals: PROPOSALS },
    });
    expect(await screen.findByText("J'ai lu les tests.")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Claude's proposals" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(4);
    expect(within(list).getByText("New local column")).toBeInTheDocument();
    expect(within(list).getByText("Local only")).toBeInTheDocument();
    expect(within(list).getByText("Xray · standard")).toBeInTheDocument();
    expect(within(list).getByText("Xray")).toBeInTheDocument();
    expect(within(list).getByText("empty — Claude never fills it")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Claude's proposals" })).toContainElement(list);
    expect(within(list).getByText("empty — Claude stops filling it")).toBeInTheDocument();
    expect(within(list).getByText("LFRPS12-1420 le fait.")).toBeInTheDocument();
    expect(ask()).toHaveTextContent("Ask again");
  });

  it("its Context is what the columns question is given; what is ticked goes with the question and is kept with it", async () => {
    net.routes["claude.preview"] = (i) =>
      previewOf(
        [
          piece("instruction", "Columns: propose"),
          piece("context:glossaire", "Glossaire", { why: "A default of the project" }),
          piece("doc:D401", "Spécifications J5"),
        ],
        i,
      );
    answers({ ok: true, summary: "Voilà.", proposals: [] });
    const context = () => screen.getByRole("button", { name: /^Context/ });
    const first = mount();
    await waitFor(() => expect(context()).toHaveTextContent(/^Context3$/));
    expect(inputs("claude.preview")[0]).toEqual({ use: "columns", scope: { kind: "project" } });
    fireEvent.click(context());
    const dialog = await screen.findByRole("dialog", { name: "Context" });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "Spécifications J5" }));
    await waitFor(() => expect(within(dialog).getByRole("checkbox", { name: "Spécifications J5" })).not.toBeChecked());
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(context()).toHaveTextContent(/^Context2 · changed$/);
    first.unmount();
    mount();
    await waitFor(() => expect(context()).toHaveTextContent(/^Context2 · changed$/));
    fireEvent.click(ask());
    await waitFor(() => expect(inputs("columns.suggest")).toHaveLength(1));
    expect(inputs("columns.suggest")[0]).toEqual({ ask: "", without: ["doc:D401"] });
  });

  it("applies one proposal, then all the others, through columns.save", async () => {
    answers({ ok: true, summary: "Voilà.", proposals: PROPOSALS });
    net.routes["columns.save"] = () => [];
    const { client } = mount();
    client.setQueryData([DIR, "project.info"], info());
    fireEvent.click(ask());
    const list = await screen.findByRole("list", { name: "Claude's proposals" });
    fireEvent.click(
      within(within(list).getByRole("listitem", { name: "Poste" })).getByRole("button", { name: "Add the column" }),
    );
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    expect(inputs("columns.save")[0]).toEqual({ name: "Poste", description: "Le poste." });
    expect(await screen.findByText("Poste: added")).toBeInTheDocument();
    expect(client.getQueryState([DIR, "project.info"])?.isInvalidated).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Apply all 3" }));
    await waitFor(() => expect(calls("columns.save")).toHaveLength(4));
    expect(await screen.findByText("3 columns updated")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Claude's proposals" })).toBeNull();
  });

  it("dismisses proposals, and says when a save fails", async () => {
    answers({ ok: true, summary: "", proposals: PROPOSALS.slice(0, 2) });
    net.routes["columns.save"] = () => {
      throw new Fail("Disk full");
    };
    mount();
    fireEvent.click(ask());
    const list = await screen.findByRole("list", { name: "Claude's proposals" });
    fireEvent.click(
      within(within(list).getByRole("listitem", { name: "Expected Result" })).getByRole("button", { name: "Dismiss" }),
    );
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Apply all/ })).toBeNull();
    fireEvent.click(within(list).getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("Could not save the column")).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });

  it("drops a proposal the columns already hold, and dismisses the whole answer", async () => {
    answers({
      ok: true,
      summary: "",
      proposals: [{ ...PROPOSALS[0], description: "Ce que voit l'opérateur." }, PROPOSALS[1], PROPOSALS[3]],
    });
    mount();
    fireEvent.click(ask());
    const list = await screen.findByRole("list", { name: "Claude's proposals" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss all" }));
    expect(screen.queryByRole("list", { name: "Claude's proposals" })).toBeNull();
  });

  it("says when nothing is proposed, when the run failed, and when it broke", async () => {
    answers({ ok: true, summary: "Rien à changer.", proposals: [] });
    mount();
    fireEvent.click(ask());
    expect(await screen.findByText("No change proposed.")).toBeInTheDocument();
    expect(screen.getByText("Rien à changer.")).toBeInTheDocument();
    answers({
      ok: false,
      summary: "",
      proposals: [],
      diagnosis: { kind: "login", title: "x", detail: "Claude is not signed in." },
    });
    fireEvent.click(ask());
    expect(await screen.findByText("Claude is not signed in.")).toBeInTheDocument();
    answers({ ok: false, summary: "", proposals: [] });
    fireEvent.click(ask());
    expect(await screen.findByText("Claude gave no proposal.")).toBeInTheDocument();
    net.routes["columns.suggest"] = () => {
      throw new Fail("Claude Code is not installed");
    };
    fireEvent.click(ask());
    expect(await screen.findByText("Claude could not look at the columns")).toBeInTheDocument();
    const j = fakeJob({ id: "columns-c0000099", kind: "columns" });
    net.routes["columns.suggest"] = () => ({ jobId: j.id });
    fireEvent.click(ask());
    await screen.findByText(/Claude is reading the columns/);
    await act(() => j.finish({ status: "failed", error: "The run broke." }));
    expect(await screen.findByText("The run broke.")).toBeInTheDocument();
  });
});

describe("Settings › Smart columns › Ask Claude, coming back", () => {
  it("keeps the proposals when the section is left and opened again", async () => {
    answers({ ok: true, summary: "Voilà.", proposals: PROPOSALS });
    const first = mount();
    fireEvent.click(ask());
    const list = await screen.findByRole("list", { name: "Claude's proposals" });
    fireEvent.click(
      within(within(list).getByRole("listitem", { name: "Poste" })).getByRole("button", { name: "Dismiss" }),
    );
    first.unmount();
    mount();
    const again = await screen.findByRole("list", { name: "Claude's proposals" });
    expect(within(again).getAllByRole("listitem")).toHaveLength(3);
    expect(calls("columns.suggest")).toHaveLength(1);
  });

  it("finds its run again: still going (Cancel), or ended meanwhile (its proposals)", async () => {
    const j = fakeJob({ id: "columns-c0000100", kind: "columns" });
    net.routes["columns.suggest"] = () => ({ jobId: j.id });
    net.routes["jobs.cancel"] = () => ({ cancelled: true });
    const first = mount();
    fireEvent.click(ask());
    await screen.findByText(/Claude is reading the columns/);
    first.unmount();
    const second = mount();
    expect(await screen.findByText(/Claude is reading the columns/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(inputs("jobs.cancel")).toEqual([{ id: j.id }]));
    second.unmount();
    await j.finish({ status: "done", result: { ok: true, summary: "Lu.", proposals: PROPOSALS.slice(3) } });
    mount();
    expect(await screen.findByRole("listitem", { name: "Poste" })).toBeInTheDocument();
    expect(screen.queryByText(/Claude is reading the columns/)).toBeNull();
  });

  it("after a reload, a run still going is found in jobs.list", async () => {
    fakeJob({ id: "columns-c0000101", kind: "columns" });
    net.routes["jobs.list"] = () => [
      { id: "columns-c0000101", kind: "columns", subject: "", status: "running", startedAt: "" },
    ];
    mount();
    expect(await screen.findByText(/Claude is reading the columns/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("waits while Claude is not there, and a run that failed on the sign-in says so", async () => {
    net.routes["claude.status"] = () => ({ installed: false, version: null, signedIn: null });
    const first = mount();
    expect((await screen.findAllByText("Claude is not connected")).length).toBeGreaterThan(0);
    expect(ask()).toBeDisabled();
    first.unmount();
    net.routes["claude.status"] = () => ({ installed: true, version: "2.1.0", signedIn: null });
    answers({
      ok: false,
      summary: "",
      proposals: [],
      diagnosis: { kind: "login", title: "x", detail: "Run claude and sign in." },
    });
    mount();
    await waitFor(() => expect(ask()).toBeEnabled());
    fireEvent.click(ask());
    expect((await screen.findAllByText("Claude is not signed in")).length).toBeGreaterThan(0);
    expect(ask()).toBeDisabled();
  });
});
