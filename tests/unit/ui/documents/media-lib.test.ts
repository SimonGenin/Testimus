import { describe, expect, it } from "vitest";
import type { Job } from "../../../../src/core/types.ts";
import { batchJob, batchLine, isObserved } from "../../../../src/ui/lib/media.ts";
import { leftOut } from "../../../../src/ui/screens/documents/BatchFiles.tsx";
import { withAnnex } from "../../../../src/ui/screens/generate/AnnexScope.tsx";

const toc = [
  { anchor: "§5", title: "Traction", level: 1 },
  { anchor: "§5.6", title: "Objets", level: 2 },
  { anchor: "§6", title: "Signal", level: 1 },
  { anchor: "§lot-a", title: "Annexe — A", level: 0 },
  { anchor: "§lot-a.p1", title: "p1", level: 1 },
  { anchor: "§lot-b", title: "Annexe — B", level: 0 },
];

describe("batches on the page", () => {
  it("tells an annex anchor from the body's", () => {
    expect(["§lot-a", "§ lot-a.p1", "fig:lot-a.p1"].map(isObserved)).toEqual([true, true, true]);
    expect(["§5.6.6", "fig:40", "§lotissement"].map(isObserved)).toEqual([false, false, false]);
  });

  it("says what a batch holds and what Claude has not read", () => {
    expect(batchLine({ photos: 14, videos: 2, analysed: 14, failed: 0 })).toBe("14 photos · 2 videos");
    expect(batchLine({ photos: 3, videos: 0, analysed: 1, failed: 1 })).toBe(
      "3 photos · 1 unreadable · 1 not read yet",
    );
  });

  it("leaves one annex out of a whole document, and comes back to the whole document", () => {
    const out = withAnnex("all", toc, "§lot-a", false);
    expect(out).toEqual(["§5", "§6", "§lot-b"]);
    expect(withAnnex(out, toc, "§lot-a", true)).toBe("all");
    expect(withAnnex("none", toc, "§lot-b", true)).toEqual(["§lot-b"]);
  });

  it("finds the batch job of a document, or of one batch", () => {
    const job = (subject: string, status = "running") => ({ kind: "media", status, subject }) as Job;
    const jobs = [job("D · a"), job("DX"), job("D", "done")];
    expect(batchJob(jobs, "D", "a")?.subject).toBe("D · a");
    expect(batchJob(jobs, "D")?.subject).toBe("D · a");
    expect(batchJob(jobs, "D", "b")).toBeUndefined();
    expect(batchJob([job("DX")], "D")).toBeUndefined();
  });

  it("says why a picked file will be left out", () => {
    expect([leftOut("a.JPG"), leftOut("b.mp4"), leftOut("c.txt")]).toEqual([null, "a later version", "not a photo"]);
  });
});
