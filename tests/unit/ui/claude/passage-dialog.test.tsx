// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Passage } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { PassageDialog } from "../../../../src/ui/components/sources/PassageDialog.tsx";
import { docLink } from "../../../../src/ui/components/sources/PassageView.tsx";
import { closeToast } from "../../../../src/ui/lib/toast.ts";
import { callsOf, dataWrapper, deferred, Fail, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

const ids: number[] = [];

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["jobs.show"] = (i) => ({ job: null, events: [], id: i.id });
});

afterEach(() => {
  act(() => {
    for (const id of ids) closeToast(id, true);
  });
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setProject(null);
});

describe("Passage dialog", () => {
  const passage: Passage = {
    docId: "D",
    anchor: "§1",
    path: "Ch 1 > Menus",
    title: "Menus",
    text: "Le menu ne propose que Propriétés.",
    figures: [],
    doc: { code: "SOSIE_211", title: "Spécification", version: "3", status: "validated" },
  };

  it("loads the passage, highlights the quote and opens it in its document", async () => {
    const gate = deferred();
    net.routes["rag.passage"] = async () => {
      await gate.promise;
      return passage;
    };
    const close = vi.fn();
    const open = vi.fn();
    render(
      <PassageDialog source={{ docId: "D", anchor: "§1", quote: "Propriétés" }} onClose={close} onOpenDoc={open} />,
    );
    expect(screen.getByRole("status", { name: "Loading the passage" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "D §1" })).toHaveTextContent(/D\s*· §1/);
    expect(screen.getByRole("region", { name: "Source D §1" })).toBeInTheDocument();
    await act(async () => gate.resolve(null));
    expect(await screen.findByText(/· Spécification · v3 ·/)).toBeInTheDocument();
    expect(screen.getByText("SOSIE_211")).toBeInTheDocument();
    expect(screen.getByText("Validated")).toBeInTheDocument();
    expect(screen.queryByText(/of \d+ sources/)).toBeNull();
    expect(callsOf("rag.passage")[0].input).toEqual({ ref: "D#§1" });
    fireEvent.click(screen.getByRole("button", { name: /Open in document/ }));
    expect(open).toHaveBeenCalledWith("D", "§1", "Propriétés");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalled();
  });

  it("from a step: « Source of step n » and ‹ › through the step's sources", async () => {
    net.routes["rag.passage"] = (i) => {
      const ref = (i as { ref: string }).ref;
      return { ...passage, anchor: ref.split("#")[1], title: `Titre ${ref}` };
    };
    const a = { docId: "D", anchor: "§1", quote: "Propriétés" };
    const b = { docId: "D", anchor: "§2", quote: "" };
    const open = vi.fn();
    render(
      <PassageDialog
        source={b}
        from={{ test: "LFRPS12-1420", step: 3, sources: [a, b] }}
        onClose={() => {}}
        onOpenDoc={open}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Source of step 3" })).toBeInTheDocument();
    expect(screen.getByText("2 of 2 sources")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next source" })).toBeDisabled();
    expect(await screen.findByRole("heading", { name: "§ 2 Titre D#§2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Previous source" }));
    expect(screen.getByText("1 of 2 sources")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "§ 1 Titre D#§1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous source" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Open in document/ }));
    expect(open).toHaveBeenCalledWith("D", "§1", "Propriétés", { test: "LFRPS12-1420", step: 3 });
    expect(docLink("D", "§1", "Propriétés", { test: "LFRPS12-1420", step: 3 })).toBe(
      'D#§1 "Propriétés" from LFRPS12-1420 step 3',
    );
    expect(docLink("D", "§1", "", { test: "LFRPS12-1420" })).toBe("D#§1");
  });

  it("says why the passage cannot be shown, with the quote, and needs no document button", async () => {
    net.routes["rag.passage"] = () => {
      throw new Fail("No index yet");
    };
    render(<PassageDialog source={{ docId: "D", anchor: "§9", quote: "la phrase" }} onClose={() => {}} />);
    expect(await screen.findByText("This passage could not be shown: No index yet")).toBeInTheDocument();
    expect(screen.getByText("« la phrase »")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open in document/ })).toBeNull();
    cleanup();
    render(<PassageDialog source={{ docId: "D", anchor: "§9", quote: "" }} onClose={() => {}} />);
    expect(await screen.findByText(/could not be shown/)).toBeInTheDocument();
    expect(screen.queryByText(/«/)).toBeNull();
  });

  it("a source whose document was deleted says so and offers no document to open", async () => {
    net.routes["rag.passage"] = () => {
      throw new Fail("No document D in this project.");
    };
    net.routes["docs.list"] = () => [{ id: "OTHER", code: "OTHER" }];
    render(
      <PassageDialog
        source={{ docId: "D", anchor: "§9", quote: "la phrase" }}
        onClose={() => {}}
        onOpenDoc={vi.fn()}
      />,
    );
    expect(await screen.findByText("Document deleted")).toBeInTheDocument();
    expect(screen.getByText(/D is no longer a document of this project/)).toBeInTheDocument();
    expect(screen.getByText("« la phrase »")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Open in document/ })).toBeNull();
    cleanup();
    net.routes["docs.list"] = () => [{ id: "D-folder", code: "D" }];
    render(<PassageDialog source={{ docId: "D", anchor: "§9", quote: "" }} onClose={() => {}} onOpenDoc={vi.fn()} />);
    expect(await screen.findByText(/could not be shown/)).toBeInTheDocument();
    await waitFor(() => expect(callsOf("docs.list").length).toBeGreaterThan(1));
    expect(screen.queryByText("Document deleted")).toBeNull();
    expect(screen.getByRole("button", { name: /Open in document/ })).toBeInTheDocument();
  });

  it("drops an answer that lands after it closed", async () => {
    const ok = deferred();
    const ko = deferred();
    let n = 0;
    net.routes["rag.passage"] = async () => {
      n++;
      if (n === 1) {
        await ok.promise;
        return passage;
      }
      await ko.promise;
      throw new Fail("late");
    };
    const a = render(<PassageDialog source={{ docId: "D", anchor: "§1", quote: "" }} onClose={() => {}} />);
    a.unmount();
    const b = render(<PassageDialog source={{ docId: "D", anchor: "§2", quote: "" }} onClose={() => {}} />);
    b.unmount();
    await act(async () => {
      ok.resolve(null);
      ko.resolve(null);
    });
    expect(n).toBe(2);
  });
});
