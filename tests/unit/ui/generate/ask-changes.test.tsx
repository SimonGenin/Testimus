// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocRef } from "../../../../src/core/types.ts";
import { GenerateScreen } from "../../../../src/ui/screens/generate/GenerateScreen.tsx";
import { piece, previewOf } from "../../helpers/fake-preview.ts";
import { choose } from "../../helpers/select.ts";
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
    suggestions: [],
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
    const scope = within(ask).getByRole("combobox", { name: "Scope" });
    expect(scope).toHaveTextContent("All 2 tests");
    expect(named("actions.list").map((c) => c.input)).toContainEqual({
      generation: "g1",
      view: { kind: "generation", id: "g1" },
    });
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
    const rows = () =>
      within(within(written).getByRole("tree", { name: "Tests of the generation" })).getAllByRole("treeitem");
    expect(rows()).toHaveLength(2);
    expect(rows()[1]).toHaveTextContent("1 fix");
    fireEvent.click(screen.getByRole("button", { name: "Show only these 1" }));
    expect(rows()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show all the tests" }));
    fireEvent.click(within(onCard).getByRole("button", { name: "Dismiss « Fix the 2 errors in « Avec TK » »" }));
    await waitFor(() => expect(named("actions.dismiss")[0]?.input).toEqual({ id: "act-1" }));

    choose(scope, "The 1 with a fix");
    fireEvent.change(within(ask).getByRole("textbox", { name: "What should change?" }), {
      target: { value: "Corrige" },
    });
    fireEvent.click(within(ask).getByRole("button", { name: /^Ask Claude/ }));
    await waitFor(() => expect(named("gen.revise")).toHaveLength(1));
    expect(named("gen.revise")[0].input).toMatchObject({ mode: "change", tests: [B] });
    choose(scope, "All 2 tests");

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

  it("New tests asks for more under the same generation; Pick tests opens the picker and sends only the ones used", async () => {
    done();
    mountData(<GenerateScreen />);
    const ask = await screen.findByRole("region", { name: "Ask for changes" });
    const scope = within(ask).getByRole("combobox", { name: "Scope" });
    choose(scope, /^New tests/);
    const box = within(ask).getByRole("textbox", { name: "What should change?" });
    fireEvent.change(box, { target: { value: "Le défaut de la TK" } });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(named("gen.revise")).toHaveLength(1));
    expect(named("gen.revise")[0].input).toMatchObject({ mode: "add", request: "Le défaut de la TK" });

    choose(scope, /^Pick tests…/);
    const dialog = screen.getByRole("dialog", { name: "Pick the tests to change" });
    expect(within(dialog).getByRole("button", { name: "Use these tests" })).toBeDisabled();
    const tree = await within(dialog).findByRole("list", { name: "Tests to run" });
    expect(within(tree).getAllByRole("checkbox")).toHaveLength(2);
    fireEvent.click(within(tree).getByRole("checkbox", { name: "Avec TK" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Use these 1 test" }));
    expect(screen.queryByRole("dialog", { name: "Pick the tests to change" })).toBeNull();
    expect(scope).toHaveTextContent("1 test picked");
    fireEvent.change(box, { target: { value: "Raccourcis" } });
    fireEvent.click(within(ask).getByRole("button", { name: /^Ask Claude/ }));
    await waitFor(() => expect(named("gen.revise")).toHaveLength(2));
    expect(named("gen.revise")[1].input).toMatchObject({ mode: "change", tests: [B], request: "Raccourcis" });
  });

  it("the block's Context is asked for this generation — what it ran with — and what is ticked there goes with the request", async () => {
    done();
    api.routes["claude.preview"] = (i) =>
      previewOf(
        [
          piece("instruction", "Ask Claude on several tests"),
          piece("context:glossary", "Glossary", { why: "The generation ran with it" }),
        ],
        i,
      );
    mountData(<GenerateScreen />);
    const ask = await screen.findByRole("region", { name: "Ask for changes" });
    const previews = () => named("claude.preview").map((c) => c.input);
    await waitFor(() =>
      expect(previews()).toContainEqual({
        use: "ask-tests",
        scope: { kind: "tests", testIds: [A, B] },
        generation: "g1",
      }),
    );
    choose(within(ask).getByRole("combobox", { name: "Scope" }), /^New tests/);
    await waitFor(() => expect(previews().at(-1)).toEqual({ use: "generate-add", generation: "g1" }));
    expect(previews().every((i) => i.generation === "g1")).toBe(true);
    fireEvent.click(within(ask).getByRole("button", { name: /^Context/ }));
    const dialog = await screen.findByRole("dialog", { name: "Context" });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "Glossary" }));
    await waitFor(() => expect(within(dialog).getByRole("checkbox", { name: "Glossary" })).not.toBeChecked());
    expect(previews().at(-1)).toEqual({ use: "generate-add", generation: "g1", without: ["context:glossary"] });
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    fireEvent.change(within(ask).getByRole("textbox", { name: "What should change?" }), {
      target: { value: "Le défaut de la TK" },
    });
    fireEvent.click(within(ask).getByRole("button", { name: /^Ask Claude/ }));
    await waitFor(() => expect(named("gen.revise")).toHaveLength(1));
    expect(named("gen.revise")[0].input).toEqual({
      generation: "g1",
      request: "Le défaut de la TK",
      mode: "add",
      model: "sonnet",
      effort: "medium",
      without: ["context:glossary"],
    });
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
    fireEvent.click(within(ask).getByRole("button", { name: "Suggestions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^Cover the skipped items/ }));
    expect(within(ask).getByRole("combobox", { name: "Scope" })).toHaveTextContent("New tests");
    fireEvent.click(within(ask).getByRole("button", { name: /^Ask Claude/ }));
    await waitFor(() => expect(named("gen.revise")).toHaveLength(1));
    expect(named("gen.revise")[0].input).toMatchObject({
      mode: "add",
      request: "Write tests for the items not written, where a source now supports them.",
    });
  });

  it("the Suggestions are the ones Claude wrote for this generation when it wrote some", async () => {
    done();
    const shown = api.routes["gen.show"];
    api.routes["gen.show"] = (input) => ({
      ...(shown(input) as object),
      suggestions: [
        { label: "Add the faulty TK cases", prompt: "Add tests where the TK is faulty.", scope: "add" },
        { label: "Check each command of the menu", prompt: "Check every command of the menu against §5.6.6." },
      ],
    });
    mountData(<GenerateScreen />);
    const ask = await screen.findByRole("region", { name: "Ask for changes" });
    fireEvent.click(within(ask).getByRole("button", { name: "Suggestions" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual([
      expect.stringMatching(/^Add the faulty TK cases/),
      expect.stringMatching(/^Check each command of the menu/),
    ]);
    expect(screen.queryByRole("menuitem", { name: /^Cover the skipped items/ })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Add the faulty TK cases/ }));
    expect(within(ask).getByRole("combobox", { name: "Scope" })).toHaveTextContent("New tests");
    fireEvent.click(within(ask).getByRole("button", { name: /^Ask Claude/ }));
    await waitFor(() => expect(named("gen.revise")).toHaveLength(1));
    expect(named("gen.revise")[0].input).toMatchObject({ mode: "add", request: "Add tests where the TK is faulty." });
  });
});
