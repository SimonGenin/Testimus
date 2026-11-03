import { describe, expect, it } from "vitest";
import { type AdfDoc, adfToText, textToAdf } from "../../../../src/core/lib/adf.ts";

const doc = (...content: unknown[]): AdfDoc => ({ type: "doc", version: 1, content: content as AdfDoc["content"] });

describe("adfToText", () => {
  it("joins paragraphs with newlines and renders hard breaks", () => {
    const d = doc(
      {
        type: "paragraph",
        content: [{ type: "text", text: "line one" }, { type: "hardBreak" }, { type: "text", text: "line two" }],
      },
      { type: "paragraph", content: [] },
      { type: "paragraph", content: [{ type: "text", text: "last" }] },
    );
    expect(adfToText(d)).toBe("line one\nline two\n\nlast");
  });

  it("renders inline cards as their issue key", () => {
    const d = doc({
      type: "paragraph",
      content: [
        { type: "text", text: "Test steps are based on the following item/s:" },
        { type: "hardBreak" },
        { type: "inlineCard", attrs: { url: "https://transurb.atlassian.net/browse/BHPTCC-2174#icft=BHPTCC-2174" } },
        { type: "text", text: " - MWS TSR delete" },
      ],
    });
    expect(adfToText(d)).toBe("Test steps are based on the following item/s:\nBHPTCC-2174 - MWS TSR delete");
  });

  it("prefixes list items and keeps heading text", () => {
    const item = (t: string) => ({
      type: "listItem",
      content: [{ type: "paragraph", content: [{ type: "text", text: t }] }],
    });
    const d = doc(
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Title" }] },
      { type: "bulletList", content: [item("first"), item("second")] },
      { type: "orderedList", content: [item("one"), item("two")] },
    );
    expect(adfToText(d)).toBe("Title\n- first\n- second\n1. one\n2. two");
  });

  it("falls back to concatenated text for unknown nodes and empty input", () => {
    expect(adfToText(null)).toBe("");
    expect(adfToText(undefined)).toBe("");
    expect(
      adfToText(doc({ type: "panel", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] })),
    ).toBe("hi");
  });
});

describe("textToAdf", () => {
  it("makes one paragraph per line", () => {
    expect(textToAdf("a\n\nb")).toEqual({
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a" }] },
        { type: "paragraph", content: [] },
        { type: "paragraph", content: [{ type: "text", text: "b" }] },
      ],
    });
  });

  it("round-trips text through ADF", () => {
    for (const t of ["", "one line", "a\nb\nc", "a\n\nb", "Test steps:\nBHPTCC-1 - thing\n\ntail"])
      expect(adfToText(textToAdf(t))).toBe(t.replace(/\r\n/g, "\n"));
  });
});

describe("adf", () => {
  it("reads mentions, emoji, cards and nested nodes, and a plain string as itself", () => {
    const doc = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text" },
            { type: "mention", attrs: { text: "@Ann" } },
            { type: "mention" },
            { type: "emoji", attrs: { shortName: ":ok:" } },
            { type: "emoji", attrs: { text: "😀" } },
            { type: "emoji" },
            { type: "inlineCard", attrs: { url: "https://x/browse/AB-12" } },
            { type: "blockCard", attrs: { url: "https://x/other" } },
            { type: "inlineCard" },
            { type: "strong" },
          ],
        },
        { type: "bulletList" },
        { type: "orderedList" },
        { type: "listItem" },
      ],
    } as const;
    expect(adfToText(doc as never)).toBe("@Ann:ok:😀AB-12https://x/other");
    expect(adfToText("plain" as never)).toBe("plain");
    expect(adfToText({ type: "paragraph", content: [{ type: "text", text: "a" }] })).toBe("a");
    expect(adfToText({ type: "doc", version: 1 } as never)).toBe("");
    expect(adfToText(null)).toBe("");
  });

  it("writes CRLF text as one paragraph per line", () => {
    expect(textToAdf("a\r\n\r\nb").content).toEqual([
      { type: "paragraph", content: [{ type: "text", text: "a" }] },
      { type: "paragraph", content: [] },
      { type: "paragraph", content: [{ type: "text", text: "b" }] },
    ]);
  });
});
