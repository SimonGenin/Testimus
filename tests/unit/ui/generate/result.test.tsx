// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CheckFile, Job, JobEvent, LocalTestRef } from "../../../../src/core/types.ts";
import { GenCard } from "../../../../src/ui/screens/generate/GenCard.tsx";
import {
  checkLine,
  type GenOutput,
  GenSummary,
  landedIds,
  passagesRead,
  RunHead,
} from "../../../../src/ui/screens/generate/GenResult.tsx";
import { xray } from "../../helpers/ui-desktop.tsx";
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

  it("GenCard: placeholders while writing or loading", () => {
    const cb = { open: true, onToggle: vi.fn(), onOpen: vi.fn(), onSource: vi.fn() };
    render(<GenCard item={{ id: "x" }} writing checking={false} xray={xray} {...cb} />);
    expect(screen.getByRole("status", { name: "Claude is writing a test" })).toHaveTextContent("Writing…");
    cleanup();
    render(<GenCard item={{ id: "x" }} writing={false} checking={false} xray={xray} {...cb} />);
    expect(screen.getByRole("status", { name: "Loading a test" })).toHaveTextContent("Loading…");
  });

  it("GenCard: the steps are shown open, fold, and open in Review or in the editor", () => {
    const onOpen = vi.fn();
    const onEdit = vi.fn();
    const onSource = vi.fn();
    const t = test("Tournois", [{ Action: "Lancer le tournoi", "Expected Result": "Le tableau s'affiche" }]);
    t.steps[0].sources = [{ docId: "D1", anchor: "§1", quote: "q" }];
    const check: CheckFile = {
      at,
      testHash: "h",
      findings: [
        { kind: "quote-not-found", severity: "error", message: "Quote absent", sources: [], step: 1 },
        { kind: "source-missing", severity: "warning", message: "Nothing on the goal", sources: [] },
      ],
    };
    const onToggle = vi.fn();
    const card1 = (open: boolean) => (
      <GenCard
        item={{ id: "x", test: t, check }}
        writing={false}
        checking={false}
        xray={xray}
        open={open}
        onToggle={onToggle}
        onOpen={onOpen}
        onEdit={onEdit}
        onSource={onSource}
      />
    );
    const { rerender } = render(card1(true));
    const card = screen.getByRole("region", { name: "Tournois" });
    expect(card).toHaveTextContent("Lancer le tournoi");
    expect(card).toHaveTextContent("Le tableau s'affiche");
    expect(card).toHaveTextContent("Quote absent");
    expect(card).toHaveTextContent("Nothing on the goal");
    expect(screen.getAllByRole("note").some((n) => n.textContent?.includes("Whole test"))).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /D1/ }));
    expect(onSource).toHaveBeenCalledWith(expect.objectContaining({ docId: "D1", anchor: "§1" }));
    fireEvent.click(screen.getByRole("button", { name: "Fold step 1" }));
    expect(screen.getByRole("button", { name: "Expand step 1" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand step 1" }));
    expect(screen.getByRole("button", { name: "Fold step 1" })).toBeInTheDocument();
    const toggle = screen.getByRole("button", { name: "Tournois" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(card1(false));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(card).not.toHaveTextContent("Lancer le tournoi");
    fireEvent.click(screen.getByRole("button", { name: "Open in Review" }));
    expect(onOpen).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open in the editor" }));
    expect(onEdit).toHaveBeenCalled();
    cleanup();
    render(
      <GenCard
        item={{ id: "x", test: test("Vide", []) }}
        writing={false}
        checking={false}
        xray={xray}
        open
        onToggle={onToggle}
        onOpen={onOpen}
        onSource={onSource}
      />,
    );
    expect(screen.getByText("This test has no steps yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in the editor" })).toBeNull();
  });

  it("GenCard: findings from the check, then from the test list (out of date ones say so)", () => {
    const t = test("", []);
    const show = (props: Partial<Parameters<typeof GenCard>[0]>) => {
      cleanup();
      render(
        <GenCard
          item={{ id: "x", test: t }}
          writing={false}
          checking={false}
          xray={xray}
          open
          onToggle={vi.fn()}
          onOpen={vi.fn()}
          onSource={vi.fn()}
          {...props}
        />,
      );
    };
    show({ check: { id: "x", ok: false, review: "to-fix", errors: 2, warnings: 0 } });
    expect(screen.getByRole("region", { name: "Untitled test" })).toBeInTheDocument();
    expect(screen.getByText("2 errors")).toBeInTheDocument();
    expect(screen.getByText("To fix")).toBeInTheDocument();
    show({ check: { id: "x", ok: false, review: "draft", errors: 0, warnings: 1 } });
    expect(screen.getByText("1 warning")).toBeInTheDocument();
    show({ check: { id: "x", ok: true, review: "checked", errors: 0, warnings: 0 } });
    expect(screen.getByText("No findings")).toBeInTheDocument();
    show({ checking: true });
    expect(screen.getByText("Checking…")).toBeInTheDocument();
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
    expect(screen.getByText("Claude is writing").parentElement).toHaveTextContent(`Claude is writing·${job().id}`);
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

  it("RunHead: fold all and unfold all once a test is there", () => {
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
    expect(screen.queryByRole("button", { name: "Fold all" })).toBeNull();
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
      />,
    );
    expect(screen.getByText(/checked line/)).toBeInTheDocument();
    expect(screen.getByText(/Claude did not say what it could not write a test for/)).toBeInTheDocument();
    const notCovered = screen.getByRole("region", { name: "Not covered · 1 — and why" });
    expect(within(notCovered).getByText("R2 alarm")).toBeInTheDocument();
    expect(within(notCovered).getByText("no passage")).toBeInTheDocument();
    expect(screen.getByText(/Claude also changed 2 existing tests: T9, T8/)).toBeInTheDocument();
    rerender(<GenSummary result={output({ reportFound: false, ok: false })} checked="" />);
    expect(screen.queryByText(/did not say/)).toBeNull();
    expect(screen.queryByText(/also changed/)).toBeNull();
    expect(screen.queryByRole("region", { name: /Not covered/ })).toBeNull();
  });
});
