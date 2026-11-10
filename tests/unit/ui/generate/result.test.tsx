// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckFile, Job, JobEvent, LocalTestRef } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { AppContext, type AppState } from "../../../../src/ui/lib/app.ts";
import { GenCard } from "../../../../src/ui/screens/generate/GenCard.tsx";
import {
  checkLine,
  type GenOutput,
  GenSummary,
  landedIds,
  passagesRead,
  RunHead,
} from "../../../../src/ui/screens/generate/GenResult.tsx";
import type { SkippedItem } from "../../../../src/ui/screens/generate/SkippedList.tsx";
import { iconOf } from "../../helpers/icons.ts";
import { fakeNet, net, renderWithData } from "../../helpers/ui-data.tsx";
import { app } from "../../helpers/ui-desktop.tsx";
import { at, job, output, ref, test } from "./fixtures.ts";

afterEach(() => {
  cleanup();
  setProject(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Generate › result helpers", () => {
  it("landedIds, passagesRead and checkLine read the events and the result", () => {
    const events: JobEvent[] = [
      { jobId: "j", at, type: "progress", message: "Writing LOCAL-AAAAAAAA" },
      { jobId: "j", at, type: "progress", message: "Writing local-aaaaaaaa again" },
      { jobId: "j", at, type: "progress", message: "Reading passages (12)" },
      { jobId: "j", at, type: "progress", message: "Reading passages (3)" },
      { jobId: "j", at, type: "log", level: "info", message: "Writing local-bbbbbbbb" },
    ];
    expect(landedIds(events, output({ tests: ["local-aaaaaaaa", "local-cccccccc"] }))).toEqual([
      "local-aaaaaaaa",
      "local-cccccccc",
    ]);
    expect(landedIds(events)).toEqual(["local-aaaaaaaa"]);
    expect(passagesRead(events)).toBe(12);
    expect(checkLine(["a"], undefined)).toBe("");
    expect(checkLine(["a"], [{ id: "a", ok: false, review: "draft", errors: 0, warnings: 2 }])).toBe(
      "All 1 test went through the check: 1 has findings.",
    );
    expect(checkLine(["a", "b"], [{ id: "a", ok: true, review: "draft", errors: 0, warnings: 0 }])).toBe(
      "All 2 tests went through the check: 0 have findings.",
    );
  });

  it("landedIds also reads the tests Claude saves through the MCP tools", () => {
    const events = [
      {
        jobId: "j",
        at,
        type: "claude",
        event: { type: "tool", name: "mcp__testimus__tests_save", input: '{"id":"local-dddddddd"}' },
      },
      { jobId: "j", at, type: "claude", event: { type: "tool", name: "Read", input: '{"id":"local-eeeeeeee"}' } },
    ] as unknown as JobEvent[];
    expect(landedIds(events)).toEqual(["local-dddddddd"]);
  });

  it("GenCard: a placeholder while loading", () => {
    render(<GenCard item={{ id: "x" }} onOpen={vi.fn()} />);
    expect(screen.getByRole("status", { name: "Loading a test" })).toHaveTextContent("Loading…");
  });

  it("GenCard: the title and the labels only — the steps are read in Review", () => {
    const onOpen = vi.fn();
    const t = test("Tournois", [{ Action: "Lancer le tournoi", "Expected Result": "Le tableau s'affiche" }]);
    const check: CheckFile = {
      at,
      testHash: "h",
      findings: [{ kind: "quote-not-found", severity: "error", message: "Quote absent", sources: [], step: 1 }],
    };
    render(<GenCard item={{ id: "x", test: t, check }} onOpen={onOpen} />);
    const card = screen.getByRole("region", { name: /^Tournois/ });
    expect(card).toHaveTextContent("1 step");
    expect(card).toHaveTextContent("Draft");
    expect(card).toHaveTextContent("Generated");
    expect(card).not.toHaveTextContent("Lancer le tournoi");
    expect(card).not.toHaveTextContent("Quote absent");
    expect(within(card).queryByRole("button", { name: "Tournois" })).toBeNull();
    expect(within(card).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(card).getByRole("button", { name: "Review" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("GenCard: an older run's review state reads as draft, not as an empty label", () => {
    render(
      <GenCard
        item={{ id: "x", test: test("T", []) }}
        check={{ id: "x", ok: true, review: "checked", errors: 0, warnings: 0 }}
        onOpen={vi.fn()}
      />,
    );
    expect(screen.getByRole("region", { name: /^T/ })).toHaveTextContent("Draft");
  });

  it("GenCard: the test's own last check wins over the generation's count once the list knows the test", () => {
    render(
      <GenCard
        item={{
          id: "x",
          test: test("T", []),
          ref: ref("x", { review: "to-fix", findings: { errors: 1, warnings: 0, infos: 0, stale: false } }),
        }}
        check={{ id: "x", ok: false, review: "draft", errors: 2, warnings: 0 }}
        onOpen={vi.fn()}
      />,
    );
    const card = screen.getByRole("region", { name: /^T/ });
    expect(within(card).getByText("1 error")).toBeInTheDocument();
    expect(within(card).queryByText("2 errors")).toBeNull();
    expect(within(card).getByText("To fix")).toBeInTheDocument();
    expect(within(card).queryByText("Draft")).toBeNull();
  });

  it("GenCard: findings from the generation's check until the list knows the test, then from the list (out of date ones say so)", () => {
    const t = test("", []);
    const show = (props: Partial<Parameters<typeof GenCard>[0]>) => {
      cleanup();
      render(<GenCard item={{ id: "x", test: t }} onOpen={vi.fn()} {...props} />);
    };
    show({ check: { id: "x", ok: false, review: "to-fix", errors: 2, warnings: 0 } });
    expect(screen.getByRole("region", { name: /^Untitled test/ })).toBeInTheDocument();
    expect(screen.getByText("2 errors")).toBeInTheDocument();
    expect(screen.getByText("To fix")).toBeInTheDocument();
    show({ check: { id: "x", ok: false, review: "draft", errors: 0, warnings: 1 } });
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    show({ check: { id: "x", ok: true, review: "draft", errors: 0, warnings: 0 } });
    expect(screen.getByText("No findings")).toBeInTheDocument();
    show({});
    expect(screen.getByText("Not checked yet")).toBeInTheDocument();
    const findings = (f: Partial<NonNullable<LocalTestRef["findings"]>>) =>
      show({
        item: {
          id: "x",
          test: test("T", []),
          ref: ref("x", { findings: { errors: 0, warnings: 0, infos: 0, stale: false, ...f } }),
        },
      });
    const stale = /out of date/i;
    findings({ errors: 3 });
    expect(screen.getByText("3 errors").closest("[aria-describedby]")).toBeNull();
    findings({ errors: 1, stale: true });
    expect(screen.getByText("1 error").closest("[aria-describedby]")).toHaveAccessibleDescription(stale);
    findings({ warnings: 2 });
    expect(screen.getByText("2 warnings").closest("[aria-describedby]")).toBeNull();
    findings({ warnings: 2, stale: true });
    expect(screen.getByText("2 warnings").closest("[aria-describedby]")).toHaveAccessibleDescription(stale);
    findings({});
    expect(screen.getByText("No findings")).toBeInTheDocument();
  });

  it("RunHead: nothing, running, done, failed, cancelled", () => {
    const onCancel = vi.fn();
    const onReview = vi.fn();
    const head = (j: Job | null, count: number, result: GenOutput | null = null) => {
      cleanup();
      return render(
        <RunHead
          job={j}
          now={Date.parse(at) + 65000}
          result={result}
          read={1}
          count={count}
          doing="Reading the documents"
          onCancel={onCancel}
          onReview={onReview}
        />,
      );
    };
    expect(head(null, 0).container).toBeEmptyDOMElement();
    head(job(), 0);
    expect(screen.getByRole("heading", { name: "Reading the documents" })).toBeInTheDocument();
    expect(screen.getByText("1 passage read")).toBeInTheDocument();
    expect(screen.getByRole("timer", { name: "Time since it started" })).toHaveTextContent("1:05");
    expect(screen.getByText("Claude is writing").parentElement).toHaveTextContent(/^Claude is writing$/);
    expect(screen.getByText("Claude is writing").parentElement).not.toHaveTextContent(job().id);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    head(job(), 2);
    expect(screen.getByText("2 tests so far")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    head(job({ status: "done", endedAt: at }), 0, output());
    expect(screen.getByText("0 tests written")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review these tests" })).toBeNull();
    head(job({ status: "done", endedAt: at }), 1, null);
    fireEvent.click(screen.getByRole("button", { name: "Review these tests" }));
    expect(onReview).toHaveBeenCalledTimes(1);
    head(
      job({ status: "done", endedAt: at }),
      1,
      output({ ok: false, diagnosis: { kind: "k", title: "Claude ran out", detail: "" } }),
    );
    expect(screen.getByText("Claude ran out")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review these tests" }));
    expect(onReview).toHaveBeenCalledTimes(2);
    head(job({ status: "failed" }), 0);
    expect(screen.getByText("The generation stopped")).toBeInTheDocument();
    head(job({ status: "cancelled" }), 0);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    head(job({ status: "cancelled" }), 3);
    expect(screen.getByText("Cancelled · 3 tests kept")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resume/ })).toBeNull();
  });

  it("RunHead: a failed run is a danger banner that says why, with Run again (refresh) and the raw error folded", () => {
    const onRetry = vi.fn();
    render(
      <RunHead
        job={job({ status: "failed", endedAt: at, error: "spawn claude: usage limit" })}
        now={Date.parse(at)}
        result={output({
          ok: false,
          diagnosis: {
            kind: "limit",
            title: "Claude stopped before writing any test",
            detail: "The usage limit was reached.",
          },
        })}
        read={0}
        count={0}
        doing=""
        onCancel={() => {}}
        onReview={() => {}}
        onRetry={onRetry}
      />,
    );
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("Claude stopped before writing any test");
    expect(banner).toHaveTextContent("The usage limit was reached.");
    expect(banner.querySelector('[data-icon="alert-circle"]')).not.toBeNull();
    expect(document.querySelector('[data-icon="x-circle"]')).toBeNull();
    const again = within(banner).getByRole("button", { name: "Run again" });
    expect(again.querySelector("[data-icon]")).toHaveAttribute("data-icon", "refresh");
    fireEvent.click(again);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("spawn claude: usage limit")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Technical details" }));
    expect(screen.getByText("spawn claude: usage limit")).toBeInTheDocument();
  });

  it("RunHead: a stopped plan offers to resume what is left", () => {
    const onResume = vi.fn();
    render(
      <RunHead
        job={job({ status: "cancelled", endedAt: at })}
        now={Date.parse(at)}
        result={null}
        read={0}
        count={2}
        doing=""
        left={3}
        onCancel={() => {}}
        onReview={() => {}}
        onResume={onResume}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Resume · 3 tests left" }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("RunHead: fold all and unfold all, before any test too (what Claude did folds with the tests)", () => {
    const onFoldAll = vi.fn();
    const head = (count: number, allFolded: boolean, j = job()) => {
      cleanup();
      render(
        <RunHead
          job={j}
          now={Date.parse(at)}
          result={null}
          read={0}
          count={count}
          doing=""
          allFolded={allFolded}
          onCancel={() => {}}
          onReview={() => {}}
          onFoldAll={onFoldAll}
        />,
      );
    };
    head(0, false);
    expect(screen.getByRole("button", { name: "Fold all" })).toBeInTheDocument();
    head(2, false);
    fireEvent.click(screen.getByRole("button", { name: "Fold all" }));
    expect(onFoldAll).toHaveBeenLastCalledWith(true);
    head(2, true, job({ status: "done", endedAt: at }));
    fireEvent.click(screen.getByRole("button", { name: "Unfold all" }));
    expect(onFoldAll).toHaveBeenLastCalledWith(false);
    head(2, false, job({ status: "cancelled", endedAt: at }));
    expect(screen.getByRole("button", { name: "Fold all" })).toBeInTheDocument();
  });

  it("GenSummary: an unreadable report, skipped items, changed tests", () => {
    const { rerender } = render(
      <GenSummary
        result={output({
          reportFound: false,
          skipped: [{ item: "R2 alarm", category: "Other", why: "no passage" }],
          changed: ["T9", "T8"],
        })}
        checked="checked line"
        open
      />,
    );
    expect(screen.getByText(/checked line/)).toBeInTheDocument();
    const unread = screen.getByText("A run's report could not be read").closest('[role="alert"]') as HTMLElement;
    expect(unread).toHaveTextContent(
      "Claude was asked again and its report still could not be read: what that run left without a test is not known, and the list below may miss some. Ask the generation again to get it.",
    );
    expect(unread.querySelector('[data-icon="alert-circle"]')).not.toBeNull();
    const notCovered = screen.getByRole("region", { name: "Not written" });
    expect(within(notCovered).getByText("R2 alarm")).toBeInTheDocument();
    expect(within(notCovered).getByText("no passage")).toBeInTheDocument();
    expect(screen.getByText(/Claude also changed 2 existing tests: T9, T8/)).toBeInTheDocument();
    rerender(<GenSummary result={output({ reportFound: false, ok: false })} checked="" />);
    expect(screen.queryByText("A run's report could not be read")).toBeNull();
    expect(screen.queryByText(/also changed/)).toBeNull();
    expect(screen.queryByRole("region", { name: /Not written/ })).toBeNull();
  });

  it("GenSummary: the unreadable-report banner opens the run's job and keeps why it could not be read, folded", () => {
    const onOpenJob = vi.fn();
    const { rerender } = render(
      <GenSummary
        result={output({
          reportFound: false,
          reportErrors: ["skipped.0.reason: Invalid option", "No gen-report block in the reply"],
        })}
        checked=""
        onOpenJob={onOpenJob}
      />,
    );
    const unread = screen.getByRole("alert");
    expect(unread).toHaveTextContent("A run's report could not be read");
    expect(unread).toHaveTextContent(
      "what that run left without a test is not known. Ask the generation again to get it.",
    );
    expect(unread).not.toHaveTextContent("the list below may miss some");
    fireEvent.click(within(unread).getByRole("button", { name: "Show the job" }));
    expect(onOpenJob).toHaveBeenCalledTimes(1);
    const why = screen.getByRole("button", { name: "Why it could not be read" });
    expect(why).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/Invalid option/)).toBeNull();
    fireEvent.click(why);
    const raw = screen.getByRole("group", { name: "Why the report could not be read" });
    expect(raw).toHaveTextContent("skipped.0.reason: Invalid option");
    expect(raw).toHaveTextContent("No gen-report block in the reply");
    rerender(<GenSummary result={output({ reportFound: false })} checked="" />);
    expect(screen.getByRole("alert")).toHaveTextContent("A run's report could not be read");
    expect(screen.queryByRole("button", { name: "Show the job" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Why it could not be read" })).toBeNull();
    rerender(<GenSummary result={output({ reportFound: true })} checked="" onOpenJob={onOpenJob} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("GenSummary: the tests not written under their category, in the core's order, cut where the category changes", () => {
    const skipped = [
      { item: "Menu B", category: "Pas de source", why: "§2 ne dit pas ce que montre l'écran" },
      { item: "Menu D", category: "Pas de source", why: "context.md : pas câblé" },
      { item: "Alarme R2", category: "Hors périmètre", why: "pas le sectionneur" },
      { item: "Menu C", category: "Other", why: "un ancien rapport" },
    ];
    render(<GenSummary result={output({ skipped })} checked="" open />);
    const list = screen.getByRole("region", { name: "Not written" });
    const groups = within(list).getAllByRole("region");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Pas de source", "Hors périmètre", "Other"]);
    expect(
      within(groups[0])
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["Menu B — §2 ne dit pas ce que montre l'écran", "Menu D — context.md : pas câblé"]);
    expect(within(groups[0]).getByText("2")).toBeInTheDocument();
    expect(within(groups[2]).getByText("Menu C")).toBeInTheDocument();
  });

  it("GenSummary: the not-covered list is folded as the screen says, and its summary asks to unfold it", () => {
    const skipped = Array.from({ length: 2 }, (_, i) => ({ item: `Item ${i}`, category: "Other", why: "no passage" }));
    const onOpenChange = vi.fn();
    render(<GenSummary result={output({ skipped })} checked="" open={false} onOpenChange={onOpenChange} />);
    const fold = screen.getByRole("button", { name: "Not written · 2" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Item 0")).toBeNull();
    fireEvent.click(fold);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it("GenSummary: an item not covered shows the passages that ask for it, and a chip opens its passage", () => {
    const openSource = vi.fn();
    const skipped = [
      {
        item: "Menu B",
        category: "Other",
        why: "no source",
        sources: ['D1#§2 "le menu B s\'ouvre"', "not a source", "D1#fig:4"],
      },
      { item: "Menu C", category: "Other", why: "" },
    ];
    const { rerender } = render(<GenSummary result={output({ skipped })} checked="" open />);
    const list = screen.getByRole("region", { name: "Not written" });
    expect(within(list).getByText("D1 §2")).toBeInTheDocument();
    expect(within(list).getAllByText("D1 Figure 4").length).toBeGreaterThan(0);
    expect(within(list).queryByText("not a source")).toBeNull();
    expect(within(list).queryByRole("button", { name: /menu B/ })).toBeNull();
    expect(within(list).getAllByRole("listitem")[1].textContent).toBe("Menu C");
    rerender(
      <AppContext.Provider value={app({ openSource })}>
        <GenSummary result={output({ skipped })} checked="" open />
      </AppContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /le menu B/ }));
    expect(openSource).toHaveBeenCalledWith({ docId: "D1", anchor: "§2", quote: "le menu B s'ouvre" });
  });
});

describe("Generate › what a generation left without a test", () => {
  const NO_SOURCE = "No source for the expected result";
  const cls = (el: Element | null) => el?.getAttribute("class") ?? "";
  const left = (over: Partial<SkippedItem> & { item: string }): SkippedItem => ({
    reason: "no-source",
    category: NO_SOURCE,
    why: "Aucun passage ne dit ce que l'écran affiche.",
    ...over,
  });
  const entry = (item: string) => screen.getByText(item).closest("li") as HTMLElement;
  const show = (skipped: SkippedItem[], over: Partial<AppState> | null = null) =>
    render(
      over ? (
        <AppContext.Provider value={app(over)}>
          <GenSummary result={output({ skipped })} checked="" open />
        </AppContext.Provider>
      ) : (
        <GenSummary result={output({ skipped })} checked="" open />
      ),
    );

  it("groups the items by reason: a gap someone can close is a warning, a reason that takes no coverage away is not", () => {
    show([
      left({ item: "Alarme R2" }),
      left({ item: "Menu D" }),
      left({ item: "Calcul du délai", reason: "not-observable", category: "Nothing a tester can observe" }),
      left({ item: "Ouverture", reason: "already-tested", category: "Already tested", why: "", test: "K-12" }),
      left({ item: "Fermeture", reason: "out-of-scope", category: "Outside the request" }),
      left({ item: "Mode dégradé", reason: "documents-disagree", category: "The documents disagree" }),
    ]);
    const groups = within(screen.getByRole("region", { name: "Not written" })).getAllByRole("region");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      NO_SOURCE,
      "Nothing a tester can observe",
      "Already tested",
      "Outside the request",
      "The documents disagree",
    ]);
    expect(within(groups[0]).getAllByRole("listitem")).toHaveLength(2);
    expect(within(groups[0]).getByText("2")).toBeInTheDocument();
    const head = (g: HTMLElement) => cls(within(g).getByText(g.getAttribute("aria-label") as string));
    const [gap, quiet, tested, outside, disagree] = groups.map(head);
    expect(disagree).toBe(gap);
    expect(tested).toBe(quiet);
    expect(outside).toBe(quiet);
    expect(quiet).not.toBe(gap);
    expect(screen.getByRole("button", { name: "Not written · 6" })).toBeInTheDocument();
    expect(screen.queryByText(/to look at/)).toBeNull();
  });

  it("states the second look Claude took at each reason — Confirmed, Can be written with its passage, Unsure", () => {
    const openSource = vi.fn();
    show(
      [
        left({ item: "Alarme R2", review: { verdict: "confirmed", why: "Cherché de nouveau : rien ne le dit." } }),
        left({
          item: "Menu D",
          review: {
            verdict: "writable",
            why: "Le §5.6.6 dit ce que le menu affiche.",
            sources: ['D1#§5.6.6 "le menu D affiche trois entrées"'],
          },
        }),
        left({ item: "Mode dégradé", review: { verdict: "unsure", why: "Deux passages se contredisent." } }),
      ],
      { openSource },
    );
    const confirmed = entry("Alarme R2");
    expect(iconOf(within(confirmed).getByText("Confirmed"))).toBe("check");
    expect(confirmed).toHaveTextContent("Cherché de nouveau : rien ne le dit.");
    expect(within(confirmed).getByText("Confirmed")).toHaveAccessibleDescription(
      "The second look Claude took at this reason while checking the tests",
    );
    const writable = entry("Menu D");
    expect(iconOf(within(writable).getByText("Can be written"))).toBe("generate");
    expect(writable).toHaveTextContent("Le §5.6.6 dit ce que le menu affiche.");
    fireEvent.click(within(writable).getByRole("button", { name: /D1 §5\.6\.6/ }));
    expect(openSource).toHaveBeenCalledWith({
      docId: "D1",
      anchor: "§5.6.6",
      quote: "le menu D affiche trois entrées",
    });
    const unsure = entry("Mode dégradé");
    expect(iconOf(within(unsure).getByText("Unsure"))).toBe("circle-dashed");
    expect(unsure).toHaveTextContent("Deux passages se contredisent.");
    const looks = ["Confirmed", "Can be written", "Unsure"].map((w) => cls(screen.getByText(w)));
    expect(new Set(looks).size).toBe(3);
    expect(screen.getByRole("button", { name: "Not written · 3" }).parentElement).toHaveTextContent("1 to look at");
  });

  it("says each doubt of Testimus' own, naming the tests, and what would let the item be written", () => {
    show([
      left({
        item: "Ouverture",
        reason: "already-tested",
        category: "Already tested",
        why: "Déjà vérifié.",
        test: "local-0000000a",
        doubts: ["local-0000000a is not a test of the project", "The run opened none of the passages it names"],
      }),
      left({ item: "Alarme R2", unblock: "Le document d'interface des alarmes, que le client peut fournir." }),
    ]);
    const doubted = entry("Ouverture");
    const doubts = within(doubted).getAllByText("Doubt");
    expect(doubts).toHaveLength(2);
    expect(iconOf(doubts[0])).toBe("alert-triangle");
    expect(doubted).toHaveTextContent("Doubt“Untitled test” is not a test of the project");
    expect(doubted).toHaveTextContent("DoubtThe run opened none of the passages it names");
    expect(doubted).toHaveTextContent("Verified by Untitled test");
    expect(within(doubted).queryByRole("button", { name: "Untitled test" })).toBeNull();
    expect(doubted).not.toHaveTextContent("To write it");
    expect(entry("Alarme R2")).toHaveTextContent(
      "To write it Le document d'interface des alarmes, que le client peut fournir.",
    );
    expect(within(entry("Alarme R2")).queryByText("Doubt")).toBeNull();
    expect(screen.getByRole("button", { name: "Not written · 2" }).parentElement).toHaveTextContent("1 to look at");
  });

  it("« N to look at » counts the items with a doubt or that can be written, also while the list is folded", () => {
    const skipped = [
      left({ item: "A", doubts: ["x"] }),
      left({ item: "B", review: { verdict: "writable", why: "y" } }),
      left({ item: "C", doubts: ["x"], review: { verdict: "writable", why: "y" } }),
      left({ item: "D", review: { verdict: "confirmed", why: "z" } }),
      left({ item: "E", review: { verdict: "unsure", why: "z" } }),
      left({ item: "F" }),
    ];
    const { rerender } = render(<GenSummary result={output({ skipped })} checked="" open={false} />);
    const fold = screen.getByRole("button", { name: "Not written · 6" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(iconOf(screen.getByText("3 to look at"))).toBe("alert-triangle");
    rerender(<GenSummary result={output({ skipped: skipped.slice(3) })} checked="" open={false} />);
    expect(screen.queryByText(/to look at/)).toBeNull();
  });

  it("« Searched and read » is folded under the item: the terms searched and the passages opened", () => {
    const openSource = vi.fn();
    show(
      [
        left({
          item: "Alarme R2",
          searched: ["alarme R2", "acquittement"],
          read: ["D1#§2", "D1#fig:4", "pas une source"],
        }),
        left({ item: "Menu D", searched: ["menu D"] }),
        left({ item: "Menu E", read: ["D1#§3"] }),
        left({ item: "Menu F" }),
      ],
      { openSource },
    );
    const first = entry("Alarme R2");
    const fold = within(first).getByRole("button", { name: "Searched and read" });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(fold.parentElement).toHaveTextContent("2 searches · 3 passages");
    expect(within(first).queryByText(/« alarme R2 »/)).toBeNull();
    fireEvent.click(fold);
    const evidence = within(first).getByRole("region", { name: "Searched and read" });
    expect(evidence).toHaveTextContent("Searched« alarme R2 » · « acquittement »");
    expect(within(evidence).getByText("Opened")).toBeInTheDocument();
    expect(within(evidence).queryByText("pas une source")).toBeNull();
    fireEvent.click(within(evidence).getByRole("button", { name: /D1 Figure 4/ }));
    expect(openSource).toHaveBeenCalledWith({ docId: "D1", anchor: "fig:4", quote: "" });
    expect(within(entry("Menu D")).getByRole("button", { name: "Searched and read" }).parentElement).toHaveTextContent(
      /Searched and read\s*1 search$/,
    );
    expect(within(entry("Menu E")).getByRole("button", { name: "Searched and read" }).parentElement).toHaveTextContent(
      /Searched and read\s*1 passage$/,
    );
    expect(within(entry("Menu F")).queryByRole("button", { name: "Searched and read" })).toBeNull();
  });

  it("an item of a result older than the reasons still renders, under Claude's own category, as a gap", () => {
    show([
      { item: "Menu C", category: "Pas de source", why: "un ancien rapport" },
      left({ item: "Calcul du délai", reason: "not-observable", category: "Nothing a tester can observe" }),
    ]);
    const groups = within(screen.getByRole("region", { name: "Not written" })).getAllByRole("region");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual(["Pas de source", "Nothing a tester can observe"]);
    expect(within(groups[0]).getByRole("listitem").textContent).toBe("Menu C — un ancien rapport");
    expect(cls(within(groups[0]).getByText("Pas de source"))).not.toBe(
      cls(within(groups[1]).getByText("Nothing a tester can observe")),
    );
    expect(screen.queryByText(/to look at/)).toBeNull();
    expect(screen.queryByText("Confirmed")).toBeNull();
  });

  it("« Verified by » names the test that already covers the item and opens it", async () => {
    fakeNet();
    setProject("C:\\gen-left");
    net.routes["tests.list"] = () => [{ id: "local-0000000a", summary: "Ouverture du sectionneur" }];
    const state = app();
    renderWithData(
      <AppContext.Provider value={state}>
        <GenSummary
          result={output({
            skipped: [
              left({
                item: "Ouverture",
                reason: "already-tested",
                category: "Already tested",
                why: "Déjà vérifié.",
                test: "local-0000000a",
                doubts: ["local-0000000a does not verify the alarm"],
              }),
            ],
          })}
          checked=""
          open
        />
      </AppContext.Provider>,
    );
    const link = await screen.findByRole("button", { name: "Ouverture du sectionneur" });
    expect(net.calls.filter((c) => c.name === "tests.list").map((c) => c.input)).toEqual([{ generating: true }]);
    expect(entry("Ouverture")).toHaveTextContent("“Ouverture du sectionneur” does not verify the alarm");
    fireEvent.click(link);
    expect(state.navigate).toHaveBeenCalledWith("tests", "local-0000000a");
  });
});
