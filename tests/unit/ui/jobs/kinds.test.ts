import { describe, expect, it } from "vitest";
import { kindLabel } from "../../../../src/ui/lib/jobs.ts";
import { KINDS, kindIcon } from "../../../../src/ui/screens/jobs/kinds.ts";

const filterOf = (kind: string) => KINDS.filter((k) => k.kinds(kind)).map((k) => k.id);

describe("the kinds of jobs", () => {
  it("a video's jobs are named in words and listed with the documents'", () => {
    expect(kindLabel("media.keep")).toBe("Key frame");
    expect(kindLabel("media.propose")).toBe("Transcript corrections");
    expect(kindLabel("media.lighten")).toBe("Lighter copy of a video");
    expect(kindLabel("media.measure")).toBe("Transcription measure");
    for (const kind of ["media.keep", "media.propose", "media.lighten", "media.measure", "docs.convert"]) {
      expect(filterOf(kind), kind).toEqual(["documents"]);
      expect(kindIcon(kind), kind).toBe("documents");
    }
  });

  it("the other kinds keep their filter", () => {
    expect(filterOf("describe-figures")).toEqual(["documents"]);
    expect(filterOf("models-pull")).toEqual(["models"]);
    expect(filterOf("rag-index")).toEqual(["index"]);
    expect(filterOf("mystery")).toEqual([]);
  });
});
