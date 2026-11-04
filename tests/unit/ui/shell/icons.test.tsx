// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchMatch } from "../../../../src/core/types.ts";
import { Activity } from "../../../../src/ui/components/shell/Activity.tsx";
import { CommandForm } from "../../../../src/ui/components/shell/CommandForm.tsx";
import { OpenByKey } from "../../../../src/ui/components/shell/OpenByKey.tsx";
import { Palette } from "../../../../src/ui/components/shell/Palette.tsx";
import type { CommandInfo } from "../../../../src/ui/lib/data/client.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { useRead } from "../../../../src/ui/lib/data/query.ts";
import { toast } from "../../../../src/ui/lib/toast.ts";
import { deferred, fakeEvents, fakeNet, job, net } from "../../helpers/ui-data.tsx";
import { clearAllToasts, withData } from "./helpers.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
  localStorage.clear();
  setProject("C:\\p");
});

afterEach(() => {
  clearAllToasts();
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

const iconOf = (el: Element | null | undefined) => el?.querySelector("[data-icon]")?.getAttribute("data-icon");
const cmd = (name: string, summary: string): CommandInfo => ({
  name,
  summary,
  mutates: false,
  job: false,
  input: { type: "object", properties: {} },
});
const option = (name: string | RegExp) => screen.getByRole("option", { name });

// ponytail: a screen reading the Jira folder tree
function JiraTree() {
  useRead("xray.folders", {});
  return null;
}

describe("the shell's icons, as the design draws them", () => {
  it("palette: a document found is a file; a command is a chevron unless the design marks it", async () => {
    const doc: SearchMatch = {
      kind: "document",
      id: "D",
      title: "Traction",
      titleMarks: [],
      marks: [],
      score: 1,
      why: "words",
    };
    net.routes["search.all"] = () => ({
      hits: [doc],
      totals: { document: 1 },
      order: ["document"],
      meaning: "on",
      unembedded: 0,
      notes: [],
    });
    const commands = [
      cmd("system.doctor", "Run the system check."),
      cmd("project.openKey", "Open a project by its Jira key."),
      cmd("xray.unpush", "Undo the last push of a test (restores Jira's copy)."),
      cmd("xray.push", "Push a test to Jira (shows the plan first)."),
      cmd("chat.ask", "Ask Claude a question about the project's documents."),
    ];
    withData(<Palette commands={commands} actions={[]} onCommand={() => {}} onHit={() => {}} onClose={() => {}} />);
    expect(iconOf(option(/Run the system check/))).toBe("chevron-right");
    expect(iconOf(option(/Open a project by its Jira key/))).toBe("chevron-right");
    expect(iconOf(option(/Undo the last push/))).toBe("undo");
    expect(iconOf(option(/Push a test to Jira/))).toBe("push");
    expect(iconOf(option(/Ask Claude a question/))).toBe("claude");
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), { target: { value: "traction" } });
    expect(iconOf(await screen.findByRole("option", { name: /Traction/ }))).toBe("file");
  });

  it("palette: while it searches, the mode badge says « Searching… » with sync", async () => {
    const load = deferred();
    net.routes["search.all"] = () => load.promise;
    withData(<Palette commands={[]} actions={[]} onCommand={() => {}} onHit={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), { target: { value: "autorisation" } });
    const badge = await screen.findByText("Searching…");
    expect(iconOf(badge)).toBe("sync");
    expect(screen.queryByText("Words + meaning")).toBeNull();
  });

  it("the command form's foot leads with terminal; Open by key heads with key", () => {
    withData(<CommandForm command={cmd("docs.list", "List the documents.")} onClose={() => {}} />);
    const foot = screen.getByText(/Same as/);
    expect(iconOf(foot)).toBe("terminal");
    cleanup();
    withData(<OpenByKey onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Open a project by its Jira key" });
    expect(dialog.querySelector('[data-icon="key"]')).not.toBeNull();
  });

  it("activity: a generation is Claude's spark, an index layers, a Jira read a spinner; « N running » turns", async () => {
    const load = deferred();
    net.routes["xray.folders"] = () => load.promise;
    net.routes["jobs.list"] = () => [
      job({ id: "g", kind: "generate", subject: "Le sectionneur" }),
      job({ id: "i", kind: "rag-index", subject: "SOSIE_211_D401-1_4" }),
    ];
    withData(
      <>
        <Activity />
        <JiraTree />
      </>,
    );
    const trigger = await screen.findByRole("button", { name: "3 jobs running" });
    expect(trigger.querySelector("svg")).toBeNull();
    fireEvent.click(trigger);
    const rows = within(screen.getByRole("dialog", { name: /^Running/ })).getAllByRole("listitem");
    const byText = (t: string) => rows.find((r) => r.textContent?.includes(t));
    expect(iconOf(byText("Loading the Jira folders"))).toBeUndefined();
    expect(byText("Loading the Jira folders")?.querySelector('span[aria-hidden="true"]')).not.toBeNull();
    expect(iconOf(byText("Le sectionneur"))).toBe("claude");
    expect(iconOf(byText("SOSIE_211_D401-1_4"))).toBe("layers");
  });

  it("a toast at the end of a Claude run is Claude's", async () => {
    withData(<span />);
    act(() => {
      toast({ kind: "claude", title: "Check finished — 2 tests, 1 with findings" });
    });
    const t = await screen.findByRole("status", { name: "Check finished — 2 tests, 1 with findings" });
    expect(iconOf(t)).toBe("claude");
  });
});
