// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef } from "../../../../src/core/types.ts";
import { GenerateScreen } from "../../../../src/ui/screens/generate/GenerateScreen.tsx";
import { api, named, xray } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { at, job, output, ref, test } from "./fixtures.ts";
import { freshPage, mountData } from "./harness.tsx";

beforeEach(freshPage);

afterEach(() => {
  cleanup();
  clearToasts();
  vi.restoreAllMocks();
});

const A = "local-aaaaaaaa";
const B = "local-bbbbbbbb";

function done() {
  const doc = {
    id: "D1",
    code: "C1",
    title: "Traction",
    status: "validated",
    converted: { with: "", at, warnings: [] },
    indexed: "fresh",
  } as unknown as DocRef;
  api.routes["project.info"] = () => ({
    dir: "C:\\p",
    project: {
      name: "RATP Sosie",
      jiraProject: "LFRPS12",
      language: "fr",
      labelPrefix: "testimus-",
      folders: [],
      rag: {},
      claude: { presets: [], contexts: [], model: "sonnet", effort: "medium" },
    },
    xray,
    columns: [],
  });
  api.routes["claude.status"] = () => ({ installed: true, signedIn: true });
  api.routes["contexts.list"] = () => [];
  api.routes["docs.list"] = () => [doc];
  api.routes["gen.preview"] = () => ({ replaces: [], searched: ["D1"], unindexed: [], stale: [] });
  api.routes["tests.list"] = () => [ref(A, { summary: "Sectionneur sans TK" }), ref(B, { summary: "Avec TK" })];
  const finished = job({
    id: "g1",
    status: "done",
    endedAt: at,
    result: output({ tests: [A, B], generation: "g1" }),
  });
  api.routes["jobs.list"] = () => [finished];
  api.routes["jobs.show"] = () => ({ job: finished, events: [] });
  api.routes["gen.show"] = () => ({
    generation: "g1",
    name: "Le sectionneur",
    request: "Le sectionneur",
    tests: [A, B],
    skipped: [],
  });
  api.routes["actions.list"] = () => [
    {
      id: "act-1",
      title: "Fix the 2 errors in « Avec TK »",
      scope: { kind: "test", testId: B },
      where: `test:${B}`,
      problem: "The check found 2 errors",
      why: "w",
      plan: [],
      stamp: "s",
      proposedBy: { run: "generate", model: "sonnet", effort: "medium", at },
      state: "open",
      at,
      stale: false,
      target: { kind: "test", id: B, name: "Avec TK" },
    },
    {
      id: "act-2",
      title: "Write the 2 tests skipped for « Commandes »",
      scope: { kind: "tests", testIds: [] },
      where: "gen:g1",
      problem: "2 tests not written",
      why: "w",
      plan: [],
      stamp: "s",
      proposedBy: { run: "generate", model: "sonnet", effort: "medium", at },
      state: "open",
      at,
      stale: false,
      target: { kind: "generation", id: "g1", name: "Le sectionneur" },
    },
  ];
  api.routes["actions.dismiss"] = (i) => ({ id: i.id });
  api.routes["tests.show"] = (i) => ({ id: i.id, test: test(i.id === B ? "Avec TK" : "Sectionneur sans TK") });
  api.routes["gen.revise"] = () => ({ jobId: "g2" });
}

describe("Generate › Ask for changes", () => {
  it("after a generation the column asks for changes on its tests; New request brings the form back", async () => {
    done();
    const { app } = mountData(<GenerateScreen />);
    const ask = await screen.findByRole("region", { name: "Ask for changes" });
    expect(within(ask).getByText("On the 2 tests of this generation")).toBeInTheDocument();
    expect(within(ask).queryByText("Le sectionneur")).not.toBeInTheDocument();
    fireEvent.click(within(ask).getByRole("button", { name: "Read the request" }));
    const reading = screen.getByRole("dialog", { name: "The request" });
    expect(within(reading).getByText("Le sectionneur")).toBeInTheDocument();
    fireEvent.click(within(reading).getByRole("button", { name: "Close" }));
    const all = within(ask).getByRole("button", { name: "All 2 tests" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(named("actions.list")[0].input).toEqual({ generation: "g1", view: { kind: "generation", id: "g1" } });
    const proposes = await within(ask).findByRole("region", { name: "Claude proposes" });
    expect(proposes).toHaveTextContent("1 fix on 1 test, each on its test at the right");
    expect(within(ask).queryByText("Fix the 2 errors in « Avec TK »")).toBeNull();
    fireEvent.click(within(proposes).getByRole("button", { name: "Run" }));
    expect(app.runInDock).toHaveBeenCalledWith({
      name: "actions.run",
      input: { id: "act-2" },
      label: "Write the 2 tests skipped for « Commandes »",
      testId: "",
    });

    const written = await screen.findByRole("region", { name: "Tests written" });
    const onCard = await within(written).findByRole("list", { name: "Fixes Claude proposes" });
    expect(onCard).toHaveTextContent("Fix the 2 errors in « Avec TK »");
    expect(onCard).toHaveTextContent("The check found 2 errors");
    fireEvent.click(within(onCard).getByRole("button", { name: "Fix" }));
    expect(app.runInDock).toHaveBeenLastCalledWith({
      name: "actions.run",
      input: { id: "act-1" },
      label: "Fix the 2 errors in « Avec TK »",
      testId: "",
    });
    expect(within(written).getAllByRole("region")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Show only these 1" }));
    expect(within(written).getAllByRole("region")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show all the tests" }));
    fireEvent.click(within(onCard).getByRole("button", { name: "Dismiss « Fix the 2 errors in « Avec TK » »" }));
    await waitFor(() => expect(named("actions.dismiss")[0]?.input).toEqual({ id: "act-1" }));

    fireEvent.click(within(ask).getByRole("button", { name: "The 1 with a fix" }));
    fireEvent.change(within(ask).getByRole("textbox", { name: "What should change?" }), {
      target: { value: "Corrige" },
    });
    fireEvent.click(within(ask).getByRole("button", { name: /^Ask Claude/ }));
    await waitFor(() => expect(named("gen.revise")).toHaveLength(1));
    expect(named("gen.revise")[0].input).toMatchObject({ mode: "change", tests: [B] });
    fireEvent.click(within(ask).getByRole("button", { name: "All 2 tests" }));

    const box = within(ask).getByRole("textbox", { name: "What should change?" });
    fireEvent.change(box, { target: { value: "Précise les actions" } });
    fireEvent.click(within(ask).getByRole("button", { name: /^Ask Claude/ }));
    await waitFor(() => expect(named("gen.revise")).toHaveLength(2));
    expect(named("gen.revise")[1].input).toMatchObject({
      generation: "g1",
      request: "Précise les actions",
      mode: "change",
      model: "sonnet",
      effort: "medium",
    });
    expect(named("gen.revise")[1].input).not.toHaveProperty("tests");

    fireEvent.click(screen.getByRole("button", { name: "New request" }));
    expect(screen.queryByRole("region", { name: "Ask for changes" })).toBeNull();
    expect(screen.getByLabelText("What should be tested?")).toBeInTheDocument();
  });

  it("Add tests asks for more under the same generation; Pick tests sends only the ones ticked", async () => {
    done();
    mountData(<GenerateScreen />);
    const ask = await screen.findByRole("region", { name: "Ask for changes" });
    fireEvent.click(within(ask).getByRole("button", { name: "Add tests" }));
    const box = within(ask).getByRole("textbox", { name: "What should change?" });
    fireEvent.change(box, { target: { value: "Le défaut de la TK" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(named("gen.revise")).toHaveLength(1));
    expect(named("gen.revise")[0].input).toMatchObject({ mode: "add", request: "Le défaut de la TK" });

    fireEvent.click(within(ask).getByRole("button", { name: "Pick tests…" }));
    const picks = within(ask).getByRole("group", { name: "Tests to change" });
    expect(within(ask).getByRole("button", { name: /^Ask Claude/ })).toBeDisabled();
    fireEvent.click(within(picks).getByRole("checkbox", { name: "Avec TK" }));
    fireEvent.change(box, { target: { value: "Raccourcis" } });
    fireEvent.click(within(ask).getByRole("button", { name: /^Ask Claude/ }));
    await waitFor(() => expect(named("gen.revise")).toHaveLength(2));
    expect(named("gen.revise")[1].input).toMatchObject({ mode: "change", tests: [B], request: "Raccourcis" });
  });

  it("while the last generation is not known yet, neither column is shown: the form never flips to Ask for changes", async () => {
    done();
    const shown = api.routes["jobs.show"];
    let answer = () => {};
    const held = new Promise<void>((r) => {
      answer = r;
    });
    api.routes["jobs.show"] = async (input) => {
      await held;
      return shown(input);
    };
    mountData(<GenerateScreen />);
    await waitFor(() => expect(named("jobs.show")).toHaveLength(1));
    expect(screen.queryByRole("region", { name: "Request" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Ask for changes" })).toBeNull();
    answer();
    expect(await screen.findByRole("region", { name: "Ask for changes" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Request" })).toBeNull();
  });

  it("Cover the skipped items asks for added tests: the core gives Claude the items not written", async () => {
    done();
    mountData(<GenerateScreen />);
    const ask = await screen.findByRole("region", { name: "Ask for changes" });
    fireEvent.click(within(ask).getByRole("button", { name: "Cover the skipped items" }));
    expect(within(ask).getByRole("button", { name: "Add tests" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(ask).getByRole("button", { name: /^Ask Claude/ }));
    await waitFor(() => expect(named("gen.revise")).toHaveLength(1));
    expect(named("gen.revise")[0].input).toMatchObject({
      mode: "add",
      request: "Write tests for the items not written, where a source now supports them.",
    });
  });
});
