// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../src/ui/api.ts";
import { Rail } from "../../src/ui/components/shell/Rail.tsx";
import { draftOf, dropDraft, useDraft } from "../../src/ui/lib/drafts.ts";
import { FixNote } from "../../src/ui/screens/review/FixNote.tsx";
import { net, withApp } from "./cov-uishell-helpers.tsx";
import { fakeFetch } from "./ui-desktop-helpers.tsx";

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
});

describe("FixNote draft", () => {
  it("keeps the note of a test the user left, and forgets it on Cancel", () => {
    const props = { claudeReady: true, onCancel: vi.fn(), onSubmit: vi.fn() };
    const r = render(<FixNote id="T-1" initial="" {...props} />);
    fireEvent.change(screen.getByLabelText(/Note for the author/), { target: { value: "step 2 is wrong" } });
    r.unmount();
    const again = render(<FixNote id="T-1" initial="" {...props} />);
    expect(screen.getByLabelText(/Note for the author/)).toHaveValue("step 2 is wrong");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    again.unmount();
    render(<FixNote id="T-1" initial="" {...props} />);
    expect(screen.getByLabelText(/Note for the author/)).toHaveValue("");
  });
});

describe("Rail memory", () => {
  it("reopens what was open on a screen, and its own entry goes to its start", () => {
    net.routes["system.doctor"] = () => [];
    net.routes["project.list"] = () => [];
    const { state, rerenderWith } = withApp(<Rail counts={{}} />, { route: { screen: "tests", arg: "T-7" } });
    rerenderWith({ route: { screen: "documents", arg: "SPEC" } });
    fireEvent.click(screen.getByRole("button", { name: /Tests/ }));
    expect(state.navigate).toHaveBeenLastCalledWith("tests", "T-7");
    fireEvent.click(screen.getByRole("button", { name: /Documents/ }));
    expect(state.navigate).toHaveBeenLastCalledWith("documents", undefined);
    rerenderWith({ route: { screen: "tests" } });
    rerenderWith({ route: { screen: "documents" } });
    fireEvent.click(screen.getByRole("button", { name: /Tests/ }));
    expect(state.navigate).toHaveBeenLastCalledWith("tests", undefined);
  });
});
