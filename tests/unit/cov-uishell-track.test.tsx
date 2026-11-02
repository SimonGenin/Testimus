// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TraceView, XrayJson } from "../../src/core/types.ts";
import { setProject } from "../../src/ui/api.ts";
import { TrackDialog } from "../../src/ui/components/traces/TrackDialog.tsx";
import { Toasts } from "../../src/ui/components/ui/index.ts";
import type { AppState } from "../../src/ui/lib/app.ts";
import { closeToast, useToasts } from "../../src/ui/lib/toast.ts";
import { callsOf, Fail, FakeES, fakeEvents, fakeNet, job, net, status, withApp } from "./cov-uishell-helpers.tsx";
import { app } from "./ui-desktop-helpers.tsx";

let ids: number[] = [];
function Probe() {
  ids = useToasts().map((t) => t.id);
  return <Toasts />;
}

beforeEach(() => {
  fakeNet();
  fakeEvents();
});

afterEach(() => {
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

const xray: XrayJson = {
  fields: [
    { id: "action", name: "Action", type: "text", builtin: true },
    { id: "c1", name: "Exigence", type: "text-single", builtin: false },
  ],
  prefs: { order: [], collapsed: [], hidden: [] },
};

const trace = (o: Partial<TraceView> = {}): TraceView => ({
  id: "req",
  label: "Exigence",
  patterns: ["EXI_\\d+"],
  field: "Exigence",
  origin: "declared",
  column: "in-xray",
  found: 3,
  docs: 1,
  ...o,
});

const withTraces = (traces: TraceView[]): Partial<AppState> => {
  const base = app().info as NonNullable<AppState["info"]>;
  return { xray, info: { ...base, traces } };
};

function mount(o: { initial?: TraceView; over?: Partial<AppState> } = {}) {
  const close = vi.fn();
  const r = withApp(
    <>
      <TrackDialog initial={o.initial} onClose={close} />
      <Probe />
    </>,
    { xray, ...o.over },
  );
  return { ...r, close };
}

const scanOf = (distinct: number, items = 1) => ({
  total: distinct,
  distinct,
  docs: [{ doc: "SOSIE_211", count: distinct, distinct }],
  items: Array.from({ length: items }, (_, i) => ({
    id: `EXI_${i}`,
    doc: "SOSIE_211",
    anchor: `§${i}`,
    context: `contexte ${i}`,
  })),
});

const patterns = () => screen.getByLabelText(/Pattern/);

describe("TrackDialog: writing the pattern", () => {
  it("checks the pattern, previews what it finds and tracks the ids", async () => {
    let scans = 0;
    net.routes["traces.find"] = () => {
      scans++;
      return scanOf(15, 12);
    };
    net.routes["traces.save"] = () => null;
    const { close, state } = mount();
    expect(screen.getByRole("dialog", { name: "Track ids from the documents" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Les codes d'alarme" }));
    expect(screen.getByLabelText(/What should Testimus pick out/)).toHaveValue("Les codes d'alarme");
    fireEvent.click(screen.getByRole("button", { name: "I know the pattern" }));
    expect(screen.queryByRole("button", { name: "I know the pattern" })).toBeNull();
    expect(screen.getByText("Write a pattern to see what it finds.")).toBeInTheDocument();
    expect(screen.getByText("Name the column to see whether Xray has it.")).toBeInTheDocument();
    fireEvent.change(patterns(), { target: { value: "EXI_(" } });
    expect(screen.getByText(/^EXI_\(: /)).toBeInTheDocument();
    fireEvent.change(patterns(), { target: { value: "a*" } });
    expect(screen.getByText("a* matches empty text")).toBeInTheDocument();
    fireEvent.change(patterns(), { target: { value: "  EXI_\\d+  \n\n" } });
    await waitFor(() => expect(screen.getByText("15 ids")).toBeInTheDocument());
    expect(callsOf("traces.find")[0].input).toEqual({ patterns: ["EXI_\\d+"], limit: 12 });
    expect(screen.getByText("and 3 more")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "First ids found" })).getAllByRole("listitem")).toHaveLength(12);
    fireEvent.change(patterns(), { target: { value: "EXI_\\d{3}" } });
    expect(await screen.findByText(/updating…/)).toBeInTheDocument();
    await waitFor(() => expect(scans).toBe(2));
    fireEvent.change(screen.getByLabelText("Name of one id"), { target: { value: " Exigence " } });
    expect(screen.getByRole("button", { name: /Track these ids/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Xray step column"), { target: { value: "Exigence" } });
    expect(screen.getByText("« Exigence » is a step field in Xray: the values are pushed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Track these ids/ }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(callsOf("traces.save")[0].input).toEqual({
      label: "Exigence",
      patterns: ["EXI_\\d{3}"],
      field: "Exigence",
      ask: "Les codes d'alarme",
    });
    expect(state.refreshInfo).toHaveBeenCalled();
    expect(screen.getByText("Exigence ids tracked")).toBeInTheDocument();
  });

  it("says nothing matches, keeps waiting on a failed scan, and asks to add a missing Xray column", async () => {
    let fail = false;
    net.routes["traces.find"] = () => {
      if (fail) throw new Fail("no index");
      return scanOf(0, 0);
    };
    let fields = 0;
    net.routes["xray.fields"] = () => {
      fields++;
      if (fields > 1) throw new Fail("Jira 401");
      return xray;
    };
    net.routes["traces.save"] = () => {
      throw new Fail("disk full");
    };
    const { state, close } = mount();
    fireEvent.click(screen.getByRole("button", { name: "I know the pattern" }));
    fireEvent.change(patterns(), { target: { value: "ALM-\\d+" } });
    expect(await screen.findByText("Nothing matches in the documents")).toBeInTheDocument();
    fail = true;
    fireEvent.change(patterns(), { target: { value: "ALM-\\d{3}" } });
    await waitFor(() => expect(callsOf("traces.find")).toHaveLength(2));
    await waitFor(() => expect(screen.queryByText("Nothing matches in the documents")).toBeNull());
    fireEvent.change(screen.getByLabelText("Xray step column"), { target: { value: "Code alarme" } });
    expect(screen.getByText("« Code alarme » is not a step field in Xray yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Check Xray again/ }));
    await waitFor(() => expect(state.refreshInfo).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /Check Xray again/ }));
    expect(await screen.findByText("Could not read the step fields from Jira")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name of one id"), { target: { value: "Alarme" } });
    fireEvent.click(screen.getByRole("button", { name: /Track these ids/ }));
    expect(await screen.findByText("Could not track these ids")).toBeInTheDocument();
    expect(callsOf("traces.save")[0].input).not.toHaveProperty("ask");
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(close).toHaveBeenCalled();
  });

  it("changes a tracked trace, refusing a column another trace already holds", async () => {
    net.routes["traces.find"] = () => scanOf(2, 2);
    net.routes["traces.save"] = () => null;
    const other = trace({ id: "alm", label: "Alarme", field: "Code alarme" });
    const initial = trace({ ask: "les exigences" });
    mount({ initial, over: withTraces([initial, other]) });
    expect(screen.getByRole("dialog", { name: "Change the tracked Exigence ids" })).toBeInTheDocument();
    expect(screen.getByLabelText(/What should Testimus pick out/)).toHaveValue("les exigences");
    expect(await screen.findByText("2 ids")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Xray step column"), { target: { value: " code ALARME " } });
    expect(screen.getByText("« Code alarme » already holds the Alarme ids.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Xray step column"), { target: { value: "Exigence" } });
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }));
    await waitFor(() => expect(callsOf("traces.save")).toHaveLength(1));
    expect(callsOf("traces.save")[0].input).toMatchObject({ id: "req", ask: "les exigences" });
  });

  it("works without a project read yet", () => {
    mount({ over: { info: null } });
    fireEvent.click(screen.getByRole("button", { name: "I know the pattern" }));
    fireEvent.change(screen.getByLabelText("Xray step column"), { target: { value: "X" } });
    expect(screen.queryByText(/already holds/)).toBeNull();
  });
});

describe("TrackDialog: asking Claude", () => {
  const ask = (text: string) => {
    fireEvent.change(screen.getByLabelText(/What should Testimus pick out/), { target: { value: text } });
  };

  it("shows what Claude reads, then fills the form with its proposal", async () => {
    net.routes["traces.propose"] = () => ({ jobId: "p1" });
    net.routes["jobs.show"] = () => ({ job: job({ id: "p1", kind: "traces" }) });
    net.routes["traces.find"] = () => scanOf(1);
    mount();
    fireEvent.keyDown(screen.getByLabelText(/What should Testimus pick out/), { key: "Enter", ctrlKey: true });
    expect(callsOf("traces.propose")).toHaveLength(0);
    ask("  les alarmes  ");
    fireEvent.keyDown(screen.getByLabelText(/What should Testimus pick out/), { key: "Enter" });
    expect(callsOf("traces.propose")).toHaveLength(0);
    fireEvent.keyDown(screen.getByLabelText(/What should Testimus pick out/), { key: "Enter", metaKey: true });
    expect(await screen.findByText(/Claude is reading the documents/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Looking…/ })).toBeDisabled();
    await waitFor(() => expect(callsOf("jobs.show")).toHaveLength(1));
    act(() => {
      FakeES.emit({ jobId: "p1", at: "", type: "claude", event: { type: "text", text: "x" } });
      FakeES.emit({
        jobId: "p1",
        at: "",
        type: "claude",
        event: { type: "tool", name: "mcp__testimus__rag_search", input: '{"query":"ALM"}' },
      });
    });
    expect(screen.getByText(/Searched the documents for “ALM”/)).toBeInTheDocument();
    act(() =>
      FakeES.emit(
        status(
          job({
            id: "p1",
            status: "done",
            result: {
              ok: true,
              summary: "",
              proposal: { label: "Alarme", patterns: ["ALM-\\d{3}"], field: "", why: "Chapter 7 lists ALM codes." },
            },
          }),
        ),
      ),
    );
    expect(await screen.findByText("Chapter 7 lists ALM codes.")).toBeInTheDocument();
    expect(callsOf("traces.propose")[0].input).toEqual({ ask: "les alarmes" });
    expect(screen.getByLabelText("Name of one id")).toHaveValue("Alarme");
    expect(patterns()).toHaveValue("ALM-\\d{3}");
    expect(screen.getByLabelText("Xray step column")).toHaveValue("Alarme");
  });

  it("explains an empty or failed proposal, and a run that broke", async () => {
    net.routes["traces.propose"] = () => ({
      ok: true,
      summary: "",
      proposal: { label: "X", patterns: [], field: "F", why: "No ids of that kind in the documents." },
    });
    mount();
    ask("les cas");
    fireEvent.click(screen.getByRole("button", { name: /Ask Claude/ }));
    expect(await screen.findByText("No ids of that kind in the documents.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name of one id")).toHaveValue("");
    net.routes["traces.propose"] = () => ({
      ok: false,
      proposal: null,
      summary: "",
      diagnosis: { detail: "Signed out" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Ask Claude/ }));
    expect(await screen.findByText("Signed out")).toBeInTheDocument();
    net.routes["traces.propose"] = () => ({ ok: true, proposal: null, summary: "" });
    fireEvent.click(screen.getByRole("button", { name: /Ask Claude/ }));
    expect(await screen.findByText(/Claude gave no proposal/)).toBeInTheDocument();
    net.routes["traces.propose"] = () => {
      throw new Fail("core down");
    };
    fireEvent.click(screen.getByRole("button", { name: /Ask Claude/ }));
    expect(await screen.findByText("Claude could not look at the documents")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ask Claude/ })).toBeEnabled();
  });

  it("keeps the proposed field when Claude names one", async () => {
    net.routes["traces.propose"] = () => ({
      ok: true,
      summary: "",
      proposal: { label: "Exigence", patterns: ["EXI_\\d+"], field: "Exigences", why: "" },
    });
    net.routes["traces.find"] = () => scanOf(1);
    mount();
    ask("exigences");
    fireEvent.click(screen.getByRole("button", { name: /Ask Claude/ }));
    await waitFor(() => expect(screen.getByLabelText("Xray step column")).toHaveValue("Exigences"));
    expect(document.querySelector(".track-why")).toBeNull();
  });
});
