// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckFile, Job, JobEvent, LocalTestRef } from "../../../../src/core/types.ts";
import { AppContext } from "../../../../src/ui/lib/app.ts";
import { GenCard } from "../../../../src/ui/screens/generate/GenCard.tsx";
import {
  checkLine,
  type GenOutput,
  GenSummary,
  landedIds,
  passagesRead,
  RunHead,
} from "../../../../src/ui/screens/generate/GenResult.tsx";
import { app } from "../../helpers/ui-desktop.tsx";
import { at, job, output, ref, test } from "./fixtures.ts";

afterEach(() => {
  cleanup();
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

  it("GenCard: findings from the check, then from the test list (out of date ones say so)", () => {
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

  it("GenSummary: missing report, skipped items, changed tests", () => {
    const { rerender } = render(
      <GenSummary
        result={output({
          reportFound: false,
          skipped: [{ item: "R2 alarm", why: "no passage" }],
          changed: ["T9", "T8"],
        })}
        checked="checked line"
        open
      />,
    );
    expect(screen.getByText(/checked line/)).toBeInTheDocument();
    expect(screen.getByText(/Claude did not say what it could not write a test for/)).toBeInTheDocument();
    const notCovered = screen.getByRole("region", { name: "Not written" });
    expect(within(notCovered).getByText("R2 alarm")).toBeInTheDocument();
    expect(within(notCovered).getByText("no passage")).toBeInTheDocument();
    expect(screen.getByText(/Claude also changed 2 existing tests: T9, T8/)).toBeInTheDocument();
    rerender(<GenSummary result={output({ reportFound: false, ok: false })} checked="" />);
    expect(screen.queryByText(/did not say/)).toBeNull();
    expect(screen.queryByText(/also changed/)).toBeNull();
    expect(screen.queryByRole("region", { name: /Not written/ })).toBeNull();
  });

  it("GenSummary: the tests not written are grouped by Claude's category, the largest group first; none is « Other »", () => {
    const skipped = [
      { item: "Alarme R2", category: "Hors périmètre", why: "pas le sectionneur" },
      { item: "Menu B", category: "Pas de source", why: "§2 ne dit pas ce que montre l'écran" },
      { item: "Menu C", why: "un ancien rapport" },
      { item: "Menu D", category: "Pas de source", why: "context.md : pas câblé" },
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
    const skipped = Array.from({ length: 2 }, (_, i) => ({ item: `Item ${i}`, why: "no passage" }));
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
      { item: "Menu B", why: "no source", sources: ['D1#§2 "le menu B s\'ouvre"', "not a source", "D1#fig:4"] },
      { item: "Menu C", why: "" },
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
