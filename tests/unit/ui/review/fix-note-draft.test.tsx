// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { FixNote } from "../../../../src/ui/screens/review/FixNote.tsx";
import { fakeFetch } from "../../helpers/ui-desktop.tsx";

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
