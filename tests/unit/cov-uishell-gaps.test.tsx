// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Passage } from "../../src/core/types.ts";
import { call, setProject } from "../../src/ui/api.ts";
import { AnswerText, parseAnswer } from "../../src/ui/components/claude/AnswerText.tsx";
import { ClaudeDock } from "../../src/ui/components/claude/ClaudeDock.tsx";
import { CommandForm } from "../../src/ui/components/shell/CommandForm.tsx";
import { useJob } from "../../src/ui/components/shell/JobLog.tsx";
import { ProjectButton } from "../../src/ui/components/shell/ProjectButton.tsx";
import { DocBadges, emphasisRuns, highlight, PassageText } from "../../src/ui/components/sources/PassageView.tsx";
import { baseName } from "../../src/ui/lib/desktop.ts";
import { useDoctor } from "../../src/ui/lib/doctor.ts";
import { useToasts } from "../../src/ui/lib/toast.ts";
import { JobsScreen } from "../../src/ui/screens/jobs/JobsScreen.tsx";
import { callsOf, deferred, FakeES, fakeEvents, fakeNet, job, net, withApp } from "./cov-uishell-helpers.tsx";

function Stores() {
  const d = useDoctor();
  const t = useToasts();
  return (
    <p>
      {d.checks.length}/{t.length}
    </p>
  );
}

function P() {
  const r = useJob("j1");
  return <span data-testid="n">{r.events.length}</span>;
}

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
  it("sends {} for a null input", async () => {
    net.routes["a.b"] = (i) => i;
    expect(await call("a.b", null)).toEqual({});
  });

  it("parses a reference at the very start of the text", () => {
    expect(parseAnswer('D#§1 "q" puis')).toEqual([{ docId: "D", anchor: "§1", quote: "q" }, " puis"]);
    expect(parseAnswer('[D#req:S.1.1 "q"] puis')).toEqual([{ docId: "D", anchor: "req:S.1.1", quote: "q" }, " puis"]);
    render(<AnswerText text="D#§2" onOpenSource={() => {}} />);
    expect(screen.getByRole("button", { name: "D §2" })).toBeInTheDocument();
  });

  it("keeps a path with no name part as it is", () => {
    expect(baseName("\\\\")).toBe("\\\\");
    expect(baseName("")).toBe("");
  });

  it("serves the stores' snapshots on the server too", () => {
    expect(renderToString(<Stores />)).toBe("<p>0<!-- -->/<!-- -->0</p>");
  });
});

describe("dock remaining paths", () => {
  it("uses Opus and high effort without a project (Xray Editor's defaults), sends with the button and ignores Escape before the job starts", async () => {
    const gate = deferred();
    net.routes["chat.ask"] = async () => {
      await gate.promise;
      return { chatId: "c", answer: "réponse" };
    };
    withApp(<ClaudeDock folded={false} onFold={() => {}} />, { info: null });
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveValue("opus");
    expect(screen.getByRole("combobox", { name: "Effort" })).toHaveValue("high");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Q" } });
    fireEvent.click(screen.getByRole("button", { name: /Send/ }));
    await waitFor(() => expect(callsOf("chat.ask")).toHaveLength(1));
    expect(screen.getByRole("button", { name: /Cancel/ })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole("complementary", { name: "Claude" }), { key: "Escape" });
    expect(callsOf("jobs.cancel")).toHaveLength(0);
    await act(async () => gate.resolve(null));
    expect(await screen.findByText("réponse")).toBeInTheDocument();
  });
});

describe("shell remaining paths", () => {
  it("shows an error instead of failing on a command without an input schema", async () => {
    render(
      <CommandForm
        command={{ name: "a.b", summary: "s", mutates: false, job: false, input: undefined as never }}
        onClose={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(callsOf("a.b")).toHaveLength(0);
  });

  it("reads a job back that has no log yet", async () => {
    net.routes["jobs.show"] = () => null;
    render(<P />);
    await waitFor(() => expect(callsOf("jobs.show")).toHaveLength(1));
    expect(screen.getByTestId("n")).toHaveTextContent("0");
  });

  it("accepts a project list it does not understand", async () => {
    net.routes["project.list"] = () => null;
    withApp(<ProjectButton />);
    fireEvent.click(screen.getByRole("button", { name: /change project/ }));
    await waitFor(() => expect(callsOf("project.list")).toHaveLength(1));
    expect(screen.getByRole("menuitem", { name: "No other project known yet" })).toBeInTheDocument();
  });

  it("shows a count without a message, and keeps progress that lands before the list", async () => {
    const gate = deferred();
    net.routes["jobs.list"] = async () => {
      await gate.promise;
      return [job({ id: "g1", progress: { done: 1, total: 3 } })];
    };
    net.routes["jobs.show"] = () => null;
    withApp(<JobsScreen />, { route: { screen: "jobs" } });
    act(() => FakeES.emit({ jobId: "g1", at: "", type: "progress", message: "early", done: 1, total: 3 }));
    await act(async () => gate.resolve(null));
    const list = await screen.findByRole("region", { name: "Job list" });
    expect(within(list).getByText("1 of 3")).toBeInTheDocument();
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
    focus: "italique",
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
        <PassageText passage={base} quote="" />
        <PassageText passage={{ ...base, anchor: "req:R1", title: "Sans numéro" }} quote="" />
        <PassageText passage={{ ...base, title: "Menus" }} quote="Gras" />
      </>,
    );
    expect(screen.getByText("archived")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "figures/f1.png" })).toHaveLength(3);
    expect(screen.getAllByRole("img", { name: "Le menu" })[0]).toHaveAttribute("src", "/files/docs/D/figures/f2.png");
    expect(screen.getAllByRole("heading").map((h) => h.textContent)).toEqual(["5.6 Menus", "Sans numéro", "5.6 Menus"]);
    expect(screen.getAllByText("italique")[0].closest("mark")).not.toBeNull();
    expect(document.querySelectorAll("mark.hl").length).toBeGreaterThan(1);
  });
});
