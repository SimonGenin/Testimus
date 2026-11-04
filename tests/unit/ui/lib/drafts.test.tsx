// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { draftOf, dropDraft, useDraft } from "../../../../src/ui/lib/drafts.ts";
import { fakeFetch } from "../../ui-desktop-helpers.tsx";

beforeEach(() => {
  fakeFetch();
  setProject("D:/p1");
});

afterEach(() => {
  cleanup();
  setProject(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

let base: (v: string) => void = () => {};

function Box({ name, initial = "" }: { name: string; initial?: string }) {
  const [text, setText, saved] = useDraft(name, initial);
  base = saved;
  return <textarea aria-label="box" value={text} onChange={(e) => setText(e.target.value)} />;
}

const box = () => screen.getByLabelText("box") as HTMLTextAreaElement;

describe("useDraft", () => {
  it("starts from its initial value and gives back what was typed after an unmount", () => {
    const r = render(<Box name="a" initial="start" />);
    expect(box().value).toBe("start");
    expect(draftOf("a")).toBeUndefined();
    fireEvent.change(box(), { target: { value: "half typed" } });
    r.unmount();
    render(<Box name="a" initial="start" />);
    expect(box().value).toBe("half typed");
  });

  it("keeps one draft per project and per key, and follows a new key", () => {
    const r = render(<Box name="a" />);
    fireEvent.change(box(), { target: { value: "for p1" } });
    r.rerender(<Box name="b" />);
    expect(box().value).toBe("");
    fireEvent.change(box(), { target: { value: "b text" } });
    r.rerender(<Box name="a" />);
    expect(box().value).toBe("for p1");
    r.unmount();
    setProject("D:/p2");
    render(<Box name="a" />);
    expect(box().value).toBe("");
  });

  it("shows a saved value without making it a draft, and never over one", () => {
    const r = render(<Box name="a" />);
    act(() => base("from the project"));
    expect(box().value).toBe("from the project");
    expect(draftOf("a")).toBeUndefined();
    fireEvent.change(box(), { target: { value: "mine" } });
    act(() => base("newer from the project"));
    expect(box().value).toBe("mine");
    r.unmount();
    dropDraft("a");
    render(<Box name="a" initial="fresh" />);
    expect(box().value).toBe("fresh");
  });

  it("keeps the Atlassian access read while a project opens, and for every project", () => {
    setProject(null);
    const r = render(<Box name="atlassian.site" />);
    act(() => base("https://mock.atlassian.net"));
    setProject("D:/p1");
    r.rerender(<Box name="atlassian.site" />);
    expect(box().value).toBe("https://mock.atlassian.net");
    fireEvent.change(box(), { target: { value: "https://other.atlassian.net" } });
    r.unmount();
    setProject("D:/p2");
    render(<Box name="atlassian.site" />);
    expect(box().value).toBe("https://other.atlassian.net");
    dropDraft("atlassian.site");
  });
});
