// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Passage } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { AnswerText, parseAnswer } from "../../../../src/ui/components/claude/AnswerText.tsx";
import { ClaudeDock } from "../../../../src/ui/components/claude/ClaudeDock.tsx";
import { DocBadges, emphasisRuns, highlight, PassageText } from "../../../../src/ui/components/sources/PassageView.tsx";
import { AppContext } from "../../../../src/ui/lib/app.ts";
import { callsOf, dataWrapper, deferred, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";
import { app } from "../../helpers/ui-desktop.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["claude.status"] = () => ({ installed: true, signedIn: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

describe("small remaining paths", () => {
  it("parses a reference at the very start of the text", () => {
    expect(parseAnswer('D#§1 "q" puis')).toEqual([{ docId: "D", anchor: "§1", quote: "q" }, " puis"]);
    expect(parseAnswer('[D#fig:3 "q"] puis')).toEqual([{ docId: "D", anchor: "fig:3", quote: "q" }, " puis"]);
    render(<AnswerText text="D#§2" onOpenSource={() => {}} />);
    expect(screen.getByRole("button", { name: "D §2" })).toBeInTheDocument();
  });
});

describe("dock remaining paths", () => {
  it("uses Opus and high effort without a project (Xray Editor's defaults), sends with the button and ignores Escape before the job starts", async () => {
    const gate = deferred();
    net.routes["claude.run"] = async () => {
      await gate.promise;
      return { ok: true, summary: "réponse" };
    };
    render(
      <AppContext.Provider value={app({ info: null })}>
        <ClaudeDock folded={false} onFold={() => {}} />
      </AppContext.Provider>,
    );
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("opus");
    expect(screen.getByRole("combobox", { name: "Effort" })).toHaveValue("high");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Q" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    await waitFor(() => expect(callsOf("claude.run")).toHaveLength(1));
    expect(screen.queryByRole("button", { name: /Cancel/ })).toBeNull();
    fireEvent.keyDown(screen.getByRole("complementary", { name: "Claude" }), { key: "Escape" });
    expect(callsOf("jobs.cancel")).toHaveLength(0);
    await act(async () => gate.resolve(null));
    expect(await screen.findByText("réponse")).toBeInTheDocument();
  });
});

describe("passage view remaining paths", () => {
  const base: Passage = {
    docId: "D",
    anchor: "§5.6",
    path: "",
    title: "5.6 Menus",
    text: "Texte ![fig](x.png)\n\n**Gras** et *italique* et * étoile",
    figures: [
      { file: "figures/f1.png", anchor: "fig:1", caption: "", description: "" },
      { file: "figures/f2.png", anchor: "fig:2", caption: "Le menu", description: "" },
    ],
    doc: { code: "C", title: "T", version: "1", status: "draft" },
  };

  it("keeps a lone star, names unknown statuses, and shows figures", () => {
    expect(emphasisRuns("a * b")).toEqual([{ text: "a * b", strong: false, em: false }]);
    expect(emphasisRuns("a *b")).toEqual([{ text: "a *b", strong: false, em: false }]);
    expect(emphasisRuns("ab*")).toEqual([{ text: "ab*", strong: false, em: false }]);
    expect(highlight("rien ici", "absent").join("")).toBe("rien ici");
    render(
      <>
        <DocBadges status="archived" />
        <PassageText passage={base} quote="italique" />
        <PassageText passage={{ ...base, anchor: "fig:1", title: "Sans numéro" }} quote="" />
        <PassageText passage={{ ...base, title: "Menus" }} quote="Gras" />
      </>,
    );
    expect(screen.getByText("archived")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "figures/f1.png" })).toHaveLength(3);
    expect(screen.getAllByRole("img", { name: "Le menu" })[0]).toHaveAttribute("src", "/files/docs/D/figures/f2.png");
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["5.6 Menus", "Sans numéro", "5.6 Menus"]);
    expect(screen.getAllByText("italique")[0].closest("mark")).not.toBeNull();
    expect(document.querySelectorAll("mark[data-hl]").length).toBeGreaterThan(1);
  });
});
