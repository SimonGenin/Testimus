// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, Test } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/api.ts";
import { EvidenceBlock } from "../../../../src/ui/screens/review/EvidenceBlock.tsx";
import { FixNote } from "../../../../src/ui/screens/review/FixNote.tsx";
import { QueueStrip } from "../../../../src/ui/screens/review/QueueStrip.tsx";
import { type BannersProps, ReviewBanners } from "../../../../src/ui/screens/review/ReviewBanners.tsx";
import { ReviewEmpty } from "../../../../src/ui/screens/review/ReviewEmpty.tsx";
import { ReviewQueue, type ReviewQueueProps } from "../../../../src/ui/screens/review/ReviewQueue.tsx";
import { iconOf, iconsIn } from "../../helpers/icons.ts";
import { fakeServer, item, mountReview, named, net } from "./helpers.tsx";

beforeEach(() => {
  fakeServer();
  setProject("C:\\review-icons");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  setProject(null);
});

const test0: Test = {
  key: "K-1",
  project: "K",
  summary: "Sectionneur",
  folder: "/",
  labels: [],
  description: "",
  covers: [],
  preconditions: [],
  review: "draft",
  steps: [],
  extra: {},
};

const banners = (over: Partial<BannersProps> = {}): BannersProps => ({
  test: test0,
  sync: "synced",
  checked: true,
  stale: false,
  claudeRunning: false,
  claudeReady: true,
  marks: null,
  onRevert: vi.fn(),
  onCompare: vi.fn(),
  onTakeJira: vi.fn(),
  onKeepMine: vi.fn(),
  ...over,
});

const queue = (over: Partial<ReviewQueueProps> = {}): ReviewQueueProps => ({
  items: [item("a", { errors: 0, warnings: 0, infos: 0 })],
  counts: { checked: 1, toFix: 0, draft: 0, unchecked: 0 },
  activeId: "a",
  filter: "all",
  sort: "anomalies",
  folder: "",
  folders: [],
  withFindings: false,
  onFilter: vi.fn(),
  onSort: vi.fn(),
  onFolder: vi.fn(),
  onWithFindings: vi.fn(),
  onOpen: vi.fn(),
  ...over,
});

describe("Review › the design's icons", () => {
  it("a row without findings says so in words, without a badge (n° 79)", () => {
    render(<ReviewQueue {...queue()} />);
    const row = within(screen.getByRole("listbox", { name: "Tests to review" })).getByRole("option");
    expect(within(row).getByText("No findings")).toBeInTheDocument();
    expect(iconOf(within(row).getByText("No findings"))).toBeUndefined();
  });

  it("the folded queue shows the queue on demand with panel-left (n° 80)", () => {
    const onShow = vi.fn();
    const { rerender } = render(<QueueStrip at={0} total={2} shown={false} onShow={onShow} onMove={vi.fn()} />);
    const show = screen.getByRole("button", { name: "Show the queue" });
    expect(iconOf(show)).toBe("panel-left");
    expect(show).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(show);
    expect(onShow).toHaveBeenLastCalledWith(true);
    rerender(<QueueStrip at={0} total={2} shown onShow={onShow} onMove={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Show the queue" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Show the queue" }));
    expect(onShow).toHaveBeenLastCalledWith(false);
  });

  it("« Check again » of a test changed since its check is refresh (n° 76)", () => {
    render(<ReviewBanners {...banners({ checked: true, stale: true, onCheck: vi.fn() })} />);
    expect(iconOf(screen.getByRole("button", { name: "Check again" }))).toBe("refresh");
  });

  it("Claude fixing the test: a lock, and « Cancel the run » stops it (n° 81)", async () => {
    const job = { id: "job-9", kind: "fix", status: "running" } as Job;
    net.routes["jobs.list"] = () => [job];
    net.routes["jobs.cancel"] = () => null;
    mountReview(<ReviewBanners {...banners({ claudeRunning: true })} />);
    const banner = screen.getByText("Claude is fixing this test").closest("[role=status]") as HTMLElement;
    expect(iconOf(banner)).toBe("lock");
    const cancel = await within(banner).findByRole("button", { name: "Cancel the run" });
    expect(iconOf(cancel)).toBe("stop");
    fireEvent.click(cancel);
    await vi.waitFor(() => expect(named("jobs.cancel")[0]?.input).toEqual({ id: "job-9" }));
  });

  it("« Cancel the run » stops the run on this test, not another test's", async () => {
    const other = { id: "fix-1", kind: "fix", status: "running", rerun: { name: "review.fix", input: { id: "K-9" } } };
    const mine = { id: "fix-2", kind: "fix", status: "running", rerun: { name: "review.fix", input: { id: "K-1" } } };
    net.routes["jobs.list"] = () => [other, mine] as Job[];
    net.routes["jobs.cancel"] = () => null;
    mountReview(<ReviewBanners {...banners({ claudeRunning: true, testId: "K-1" })} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel the run" }));
    await vi.waitFor(() => expect(named("jobs.cancel")[0]?.input).toEqual({ id: "fix-2" }));
  });

  it("the empty review offers « Open the tests » with tests and « Generate tests » with generate (n° 82, 83)", () => {
    const { rerender } = render(<ReviewEmpty validated={2} onGenerate={vi.fn()} onTests={vi.fn()} />);
    expect(iconOf(screen.getByRole("button", { name: "Open the tests" }))).toBe("tests");
    rerender(<ReviewEmpty validated={0} onGenerate={vi.fn()} onTests={vi.fn()} />);
    expect(iconOf(screen.getByRole("button", { name: "Generate tests" }))).toBe("generate");
  });

  it("the To fix note says Claude is not connected, with plug, only when it is not (n° 84)", () => {
    const { rerender } = render(
      <FixNote id="T-9" initial="" claudeReady={false} onCancel={vi.fn()} onSubmit={vi.fn()} />,
    );
    expect(iconOf(screen.getByText("Claude is not connected"))).toBe("plug");
    rerender(<FixNote id="T-9" initial="" claudeReady onCancel={vi.fn()} onSubmit={vi.fn()} />);
    expect(screen.queryByText("Claude is not connected")).toBeNull();
  });

  it("what the generation read leads with section, or image for a figure (n° 85)", async () => {
    net.routes["review.evidence"] = () => ({
      testId: "T",
      jobId: "job-1",
      consulted: [],
      read: [
        { ref: "D1#§5.2", title: "Sectionneur", cited: true },
        { ref: "D1#fig:40", title: "Figure 40", cited: false },
      ],
      searched: [],
    });
    mountReview(<EvidenceBlock testId="T" selected="" onPick={vi.fn()} />);
    expect(await screen.findByText("2 read")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Sources read/ }));
    const list = screen.getByRole("listbox", { name: "Read by the generation" });
    expect(iconsIn(within(list).getByRole("option", { name: /D1#§5\.2/ }))[0]).toBe("section");
    expect(iconsIn(within(list).getByRole("option", { name: /D1#fig:40/ }))[0]).toBe("image");
  });
});
