// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef } from "../../../../src/core/types.ts";
import { GenerateScreen } from "../../../../src/ui/screens/generate/GenerateScreen.tsx";
import { api, named, xray } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { at, job, output, ref } from "./fixtures.ts";
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
    },
  ];
  api.routes["gen.revise"] = () => ({ jobId: "g2" });
}

describe("Generate › Ask for changes", () => {
  it("after a generation the column asks for changes on its tests; New request brings the form back", async () => {
    done();
    const { app } = mountData(<GenerateScreen />);
    const ask = await screen.findByRole("region", { name: "Ask for changes" });
    expect(within(ask).getByText(/On the 2 tests of this generation · « Le sectionneur »/)).toBeInTheDocument();
    const all = within(ask).getByRole("button", { name: "All 2 tests" });
    expect(all).toHaveAttribute("aria-pressed", "true");
    const suggested = within(ask).getByRole("region", { name: "Suggested by the results" });
    fireEvent.click(within(suggested).getByRole("button", { name: "Fix the 2 errors in « Avec TK »" }));
    expect(app.runInDock).toHaveBeenCalledWith({
      name: "actions.run",
      input: { id: "act-1" },
      label: "Fix the 2 errors in « Avec TK »",
      testId: "",
    });
    expect(named("actions.list")[0].input).toEqual({ generation: "g1" });

    const box = within(ask).getByRole("textbox", { name: "What should change?" });
    fireEvent.change(box, { target: { value: "Précise les actions" } });
    fireEvent.click(within(ask).getByRole("button", { name: /^Ask Claude/ }));
    await waitFor(() => expect(named("gen.revise")).toHaveLength(1));
    expect(named("gen.revise")[0].input).toMatchObject({
      generation: "g1",
      request: "Précise les actions",
      mode: "change",
      model: "sonnet",
      effort: "medium",
    });
    expect(named("gen.revise")[0].input).not.toHaveProperty("tests");

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
});
