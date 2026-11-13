// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render as draw, fireEvent, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { DockActivity, worked } from "../../../../src/ui/components/claude/DockActivity.tsx";
import { skillOf, type Turn } from "../../../../src/ui/components/claude/turns.ts";
import { DataProvider } from "../../../../src/ui/lib/data/provider.tsx";
import { fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";

beforeEach(() => {
  fakeNet();
  fakeEvents();
});

afterEach(() => {
  cleanup();
  setProject(null);
});

const render = (ui: ReactElement) => draw(ui, { wrapper: DataProvider });

const t0 = 1_000_000;
const turn = (o: Partial<Turn>): Turn => ({
  id: 1,
  role: "assistant",
  text: "",
  startedAt: t0,
  tools: [
    { label: "Opened the generate-tests skill", done: true, at: t0 + 1000, skill: "generate-tests" },
    { label: "Listed the documents", done: true, at: t0 + 2000 },
    { label: "Read SECIB", done: true, at: t0 + 6000 },
    { label: "Ran the check", done: false, at: t0 + 75000 },
  ],
  ...o,
});

describe("Claude's activity in the dock", () => {
  it("shows the step under way and the skills while Claude works, every step under the fold", () => {
    render(<DockActivity turn={turn({ running: true })} />);
    expect(screen.getByText("Ran the check…")).toBeInTheDocument();
    expect(screen.getByText("generate-tests")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Claude's work" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /4 steps/ }));
    const list = screen.getByRole("list", { name: "Claude's work" });
    expect(list.querySelectorAll("li")).toHaveLength(4);
    expect(list).toHaveTextContent("Read SECIB0:06");
    expect(list).toHaveTextContent("Ran the check1:15");
  });

  it("folds into one line once Claude is done", () => {
    render(
      <DockActivity turn={turn({ running: false, meta: { durationMs: 72000, model: "sonnet", effort: "high" } })} />,
    );
    expect(screen.queryByText(/Ran the check…/)).toBeNull();
    expect(screen.getByRole("button", { name: /Worked 1 min 12 s · 4 steps/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByText("generate-tests")).toBeInTheDocument();
  });

  it("names a local test by its summary, never by its id", async () => {
    setProject("C:\\p");
    net.routes["tests.list"] = () => [{ id: "local-3f9a12c0", summary: "Sectionneur avec TK" }];
    render(
      <DockActivity
        turn={turn({
          running: true,
          tools: [
            { label: "Opened local-3f9a12c0", done: true, at: t0 + 1000 },
            { label: "Wrote the steps of local-00000000", done: false, at: t0 + 2000 },
          ],
        })}
      />,
    );
    expect(await screen.findByText("Wrote the steps of “Untitled test”…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /2 steps/ }));
    expect(await screen.findByText("Opened “Sectionneur avec TK”")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/local-[0-9a-f]{6,}/);
  });

  it("shows nothing when Claude used no tool", () => {
    const { container } = render(<DockActivity turn={turn({ tools: [] })} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("reads the skill's name, even from a cut input", () => {
    expect(skillOf("Skill", '{"skill":"check-test"}')).toBe("check-test");
    expect(skillOf("Skill", '{"skill":"fix-test","args":"x')).toBe("fix-test");
    expect(skillOf("Read", '{"skill":"x"}')).toBeUndefined();
    expect(worked(9000)).toBe("9 s");
    expect(worked(72000)).toBe("1 min 12 s");
  });
});
