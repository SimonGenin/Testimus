import { describe, expect, it } from "vitest";
import type { DocJson, MediaFile, SourceType } from "../../../../src/core/types.ts";
import { sourcePlace } from "../../../../src/ui/lib/fields.ts";
import { clock, isMedia, isPictureAnchor, momentOf, typeLabel } from "../../../../src/ui/lib/media.ts";

const file = (n: number, kind: MediaFile["kind"], duration?: number): MediaFile => ({
  n,
  name: `f${n}`,
  file: `files/f${n}`,
  kind,
  sha256: "x",
  state: "analysed",
  ...(duration ? { duration } : {}),
});
const doc = (type: SourceType, files?: MediaFile[]) => ({
  type,
  source: { name: "", file: "", sha256: "", ...(files ? { files } : {}) } as DocJson["source"],
});

describe("what a document is, in the list's words", () => {
  it("says Word, PDF and text by the type the core gives, images and videos with their files", () => {
    expect(typeLabel(doc("docx"))).toBe("Word");
    expect(typeLabel(doc("pdf"))).toBe("PDF");
    expect(typeLabel(doc("txt"))).toBe("Text");
    expect(typeLabel(doc("images", [file(1, "image"), file(2, "image")]))).toBe("Images · 2");
    expect(typeLabel(doc("video", [file(1, "video", 760)]))).toBe("Video · 12:40");
    expect(typeLabel(doc("mixed", [file(1, "image"), file(2, "video", 30)]))).toBe("Images · 1 · Video");
    expect([isMedia("images"), isMedia("video"), isMedia("mixed"), isMedia("pdf")]).toEqual([true, true, true, false]);
  });
});

describe("moments and anchors", () => {
  it("writes a moment as mm:ss, h:mm:ss past an hour", () => {
    expect(clock(0)).toBe("00:00");
    expect(clock(270.9)).toBe("04:30");
    expect(clock(3725)).toBe("1:02:05");
  });

  it("reads the moment of a transcript line or a key frame, with its video's number", () => {
    expect(momentOf("t:04:30")).toEqual({ n: 1, at: 270 });
    expect(momentOf("frame:3/01:00:05")).toEqual({ n: 3, at: 3605 });
    expect(momentOf("t:00:07-2")).toEqual({ n: 1, at: 7 });
    expect(momentOf("img:3")).toBeNull();
  });

  it("names a picture's anchor as people read it", () => {
    expect(isPictureAnchor("img:3")).toBe(true);
    expect(isPictureAnchor("frame:04:30")).toBe(true);
    expect(isPictureAnchor("t:04:30")).toBe(false);
    expect(sourcePlace("img:3")).toBe("Image 3");
    expect(sourcePlace("frame:04:30")).toBe("Frame 04:30");
    expect(sourcePlace("t:04:30")).toBe("04:30");
    expect(sourcePlace("fig:40")).toBe("Figure 40");
  });
});
