// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Passage, Source } from "../../../../src/core/types.ts";
import { SourceTab } from "../../../../src/ui/components/sources/SourceTab.tsx";
import { Workspace } from "../../../../src/ui/components/ui/workspace/Workspace.tsx";
import { column, layoutOf, section } from "../../../../src/ui/lib/workspace/layout.ts";
import { useWorkspace } from "../../../../src/ui/lib/workspace/useWorkspace.ts";
import { fakeEvents, fakeNet, net, renderWithData } from "../../helpers/ui-data.tsx";

const passage = (anchor: string): Passage => ({
  docId: "D",
  anchor,
  path: "Ch 1",
  title: `Titre ${anchor}`,
  text: "Le menu ne propose que Propriétés.",
  figures: [],
  doc: { code: "SOSIE_211", title: "Spécification", version: "3", status: "validated" },
});

const A: Source = { docId: "D", anchor: "§1", quote: "Propriétés" };
const B: Source = { docId: "D", anchor: "§2", quote: "menu" };

function Screen({ own = false }: { own?: boolean }) {
  const ws = useWorkspace({
    pref: "layoutTests",
    label: "Tests",
    defaults: layoutOf(
      column(300, section(["list"])),
      column(null, section(["test"])),
      column(400, section(own ? ["source", "claude"] : ["claude"], !own)),
    ),
    tabs: [
      { id: "list", label: "Tests", icon: "tree", content: <p>the list</p> },
      { id: "test", label: "Test", icon: "tests", main: true, content: <p>the test</p> },
      ...(own ? [{ id: "source", label: "Source", icon: "quote" as const, content: <p>No source open</p> }] : []),
      { id: "claude", label: "Claude", icon: "claude", claude: true, content: <p>Claude here</p> },
    ],
  });
  return <Workspace ws={ws} />;
}

function Shell({ own, sections = true }: { own?: boolean; sections?: boolean }) {
  const [opened, setOpened] = useState<{ source: Source; from?: { step: number; sources: Source[] } } | null>(null);
  return (
    <>
      {sections && <Screen own={own} />}
      <button type="button" onClick={() => setOpened({ source: A, from: { step: 2, sources: [A, B] } })}>
        open A
      </button>
      <button type="button" onClick={() => setOpened({ source: B })}>
        open B
      </button>
      <SourceTab opened={opened} onClose={() => setOpened(null)} onOpenDoc={() => {}} />
    </>
  );
}

const tab = (name: string) => screen.queryByRole("tab", { name: new RegExp(`^${name}\\b`) });

beforeEach(() => {
  localStorage.clear();
  fakeNet();
  fakeEvents();
  net.routes["rag.passage"] = (i) => passage(String(i.ref).split("#")[1]);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("a source opened", () => {
  it("is read in a Source tab beside the work, with the step's sources, and goes when closed", async () => {
    renderWithData(<Shell />);
    expect(tab("Source")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "open A" }));
    expect(tab("Source")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /^Test$/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("dialog")).toBeNull();
    const pane = screen.getByRole("complementary", { name: "Source of step 2" });
    expect(await screen.findByRole("heading", { name: "§ 1 Titre §1" })).toBeInTheDocument();
    expect(pane).toHaveTextContent("1 of 2 sources");
    fireEvent.click(tab("Claude") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "open B" }));
    expect(tab("Source")).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "§ 2 Titre §2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close the source" }));
    expect(tab("Source")).toBeNull();
  });

  it("takes the place of the screen's own Source tab while it is open", async () => {
    renderWithData(<Shell own />);
    fireEvent.click(tab("Claude") as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "open B" }));
    expect(screen.getAllByRole("tab", { name: /^Source/ })).toHaveLength(1);
    expect(tab("Source")).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByRole("heading", { name: "§ 2 Titre §2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close the source" }));
    expect(screen.getByText("No source open")).toBeInTheDocument();
  });

  it("is a dialog where the screen has no sections", async () => {
    renderWithData(<Shell sections={false} />);
    fireEvent.click(screen.getByRole("button", { name: "open B" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});
