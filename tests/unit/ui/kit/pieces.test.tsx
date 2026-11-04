// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import * as stylex from "@stylexjs/stylex";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Answer } from "../../../../src/ui/components/ui/Answer.tsx";
import { Ask } from "../../../../src/ui/components/ui/Ask.tsx";
import { Facts } from "../../../../src/ui/components/ui/Facts.tsx";
import { Field } from "../../../../src/ui/components/ui/Field.tsx";
import { Logo } from "../../../../src/ui/components/ui/Logo.tsx";
import { Pane } from "../../../../src/ui/components/ui/Pane.tsx";
import { Passage, quoteMarks } from "../../../../src/ui/components/ui/Passage.tsx";
import { Raw } from "../../../../src/ui/components/ui/Raw.tsx";
import { SaveState } from "../../../../src/ui/components/ui/SaveState.tsx";
import { Tile } from "../../../../src/ui/components/ui/Tile.tsx";
import { elapsed, Timer } from "../../../../src/ui/components/ui/Timer.tsx";
import { TYPE_STYLES, type } from "../../../../src/ui/components/ui/type.ts";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const cls = (el: Element) => el.getAttribute("class") ?? "";

describe("type: the design's text styles (audit n° 19, 46)", () => {
  it("names every style of SYSTEM.md « Type », each a different look, the titles tightened", () => {
    expect(TYPE_STYLES).toEqual(
      expect.arrayContaining(["caption", "small", "compact", "body", "titleSm", "title", "titleLg", "display"]),
    );
    expect(TYPE_STYLES).toEqual(expect.arrayContaining(["reading", "code", "label"]));
    for (const name of TYPE_STYLES) expect(type[name], name).toBeTruthy();
    render(
      <div>
        {TYPE_STYLES.map((n) => (
          <span key={n} data-testid={n} {...stylex.props(type[n])} />
        ))}
      </div>,
    );
    const looks = new Set(TYPE_STYLES.map((n) => cls(screen.getByTestId(n))));
    expect(looks.size).toBe(TYPE_STYLES.length);
  });
});

describe("SaveState (audit n° 1, 46)", () => {
  it("says Edited only after a second of a pending edit", async () => {
    vi.useFakeTimers();
    render(<SaveState status="pending" />);
    expect(screen.queryByText("Edited · saves in a moment")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(screen.getByText("Edited · saves in a moment")).toBeInTheDocument();
  });

  it("offers Retry when the save failed, as an alert", () => {
    const retry = vi.fn();
    render(<SaveState status="error" onRetry={retry} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Not saved");
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("says Claude is editing, read-only in its tooltip; an activity wins over the status", () => {
    const { rerender } = render(<SaveState status="claude" />);
    expect(screen.getByText("Claude is editing").closest("[title]")).toHaveAttribute(
      "title",
      "Read-only until the run ends",
    );
    rerender(<SaveState status="saved" activity="Refreshing from Jira…" live />);
    expect(screen.getByRole("status")).toHaveTextContent("Refreshing from Jira…");
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("shows Saved with its time, and in a fading field only for 3 s after a save", async () => {
    vi.useFakeTimers();
    const { rerender } = render(<SaveState status="saved" at="10:42" />);
    expect(screen.getByText("Saved").closest("[title]")).toHaveAttribute("title", "Saved 10:42");
    rerender(<SaveState status="saving" fade />);
    rerender(<SaveState status="saved" fade />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(screen.queryByText("Saved")).toBeNull();
  });
});

describe("Field (audit n° 9, 36, 52)", () => {
  it("names its control by the label, with the state at its right, the error then the hint under it", () => {
    render(
      <Field
        label="Folder"
        htmlFor="f"
        state={<span>Saved</span>}
        error="Use an absolute path"
        errorId="e"
        hint="Kept here"
        hintId="h"
      >
        <input id="f" aria-describedby="e h" />
      </Field>,
    );
    const field = screen.getByRole("textbox", { name: "Folder" });
    expect(field).toHaveAccessibleDescription("Use an absolute path Kept here");
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("without htmlFor, shows the label for the eye only", () => {
    render(
      <Field label="Scope">
        <div role="radiogroup" aria-label="Scope" />
      </Field>,
    );
    expect(screen.getByText("Scope", { selector: "span" })).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Answer and Ask (audit n° 10, 25)", () => {
  it("an answer is a region with Claude's spark, its body, meta and foot", () => {
    render(
      <Answer meta="12.3 s" footer={<button type="button">Revert</button>}>
        Le menu diffère.
      </Answer>,
    );
    const a = screen.getByRole("region", { name: "Claude" });
    expect(a.querySelector('[data-icon="claude"]')).not.toBeNull();
    expect(within(a).getByText("12.3 s")).toBeInTheDocument();
    expect(within(a).getByRole("button", { name: "Revert" })).toBeInTheDocument();
  });

  it("a failed run has the alert icon and another ground", () => {
    const { container } = render(
      <>
        <Answer>ok</Answer>
        <Answer title="The run failed" error>
          stopped
        </Answer>
      </>,
    );
    const failed = screen.getByRole("region", { name: "The run failed" });
    expect(failed.querySelector('[data-icon="alert-circle"]')).not.toBeNull();
    expect(cls(failed)).not.toBe(cls(container.querySelector("section") as Element));
  });

  it("an ask keeps the words as typed and says when nothing was typed", () => {
    const { rerender } = render(<Ask meta="Step 2">{"Ajoute\nle cas négatif"}</Ask>);
    expect(screen.getByRole("region", { name: "Request · Step 2" })).toHaveTextContent("Ajoute le cas négatif");
    rerender(<Ask empty="No request" />);
    expect(screen.getByText("No request")).toBeInTheDocument();
  });
});

describe("Passage (audit n° 11, 26)", () => {
  it("finds the quote case and spaces aside, in the paragraph's own offsets", () => {
    expect(quoteMarks("Selon le  type, le Menu diffère.", "le menu   diffère")).toEqual([[16, 31]]);
    expect(quoteMarks("rien", "absent")).toEqual([]);
  });

  it("draws the reference, the numbered heading, marks the quote and mutes the other paragraphs with dim", () => {
    render(
      <Passage
        reference="D401 §5.6.6"
        anchor="§ 5.6.6"
        heading="Menu contextuel"
        level={4}
        paragraphs={["Le menu diffère.", "Autre chose."]}
        quote="menu diffère"
        dim
      />,
    );
    expect(screen.getByRole("heading", { level: 4 })).toHaveTextContent("§ 5.6.6Menu contextuel");
    expect(screen.getByText("menu diffère", { selector: "mark" })).toBeInTheDocument();
    const cited = screen.getByText("menu diffère").closest("p") as Element;
    const other = screen.getByText("Autre chose.");
    expect(cited).toHaveAttribute("data-cited", "true");
    expect(cls(other)).not.toBe(cls(cited));
  });

  it("stands a placeholder in for a figure without its picture, and shows a picture with its caption", () => {
    render(
      <Passage
        paragraphs={[]}
        figures={[{ caption: "Figure 1" }, { src: "/f.png", caption: "Figure 2", alt: "Poste" }]}
      />,
    );
    expect(screen.getByRole("img", { name: "Figure 1" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Poste" })).toHaveAttribute("src", "/f.png");
    expect(screen.getByText("Figure 2", { selector: "figcaption" })).toBeInTheDocument();
  });
});

describe("Raw (audit n° 38)", () => {
  it("keeps a text as it came, and says when there is nothing", () => {
    const { rerender, container } = render(<Raw text={"a\n  b"} />);
    expect(container.querySelector("pre")?.textContent).toBe("a\n  b");
    rerender(<Raw text="" empty="Nothing logged yet." />);
    expect(screen.getByText("Nothing logged yet.")).toBeInTheDocument();
  });

  it("a live log is a log region; each line keeps its level and its time", () => {
    render(
      <Raw
        label="Live log"
        follow
        lines={[
          { text: "ok", at: "10:00:01" },
          { text: "careful", level: "warn" },
          { text: "broke", level: "error" },
        ]}
      />,
    );
    const log = screen.getByRole("log", { name: "Live log" });
    expect(within(log).getByText("10:00:01")).toBeInTheDocument();
    const levels = [...log.querySelectorAll("[data-level]")].map((l) => l.getAttribute("data-level"));
    expect(levels).toEqual(["info", "warn", "error"]);
    const [ok, warn, err] = [...log.querySelectorAll("[data-level]")].map(cls);
    expect(new Set([ok, warn, err]).size).toBe(3);
  });
});

describe("Facts (audit n° 39)", () => {
  it("lists name and value, leaving out the rows that do not apply", () => {
    render(
      <Facts label="Pack" items={[{ label: "Model", value: "bge-m3" }, false, { label: "Size", value: "1 GB" }]} />,
    );
    const list = screen.getByText("Model").closest("dl") as Element;
    expect(list).toHaveAccessibleName("Pack");
    expect([...list.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Model", "Size"]);
    expect([...list.querySelectorAll("dd")].map((d) => d.textContent)).toEqual(["bge-m3", "1 GB"]);
  });
});

describe("Timer (audit n° 44)", () => {
  it("counts m:ss, h:mm:ss past an hour, as a timer", () => {
    expect(elapsed(5)).toBe("0:05");
    expect(elapsed(75)).toBe("1:15");
    expect(elapsed(3725)).toBe("1:02:05");
    render(<Timer seconds={12} />);
    expect(screen.getByRole("timer", { name: "Time since it started" })).toHaveTextContent("0:12");
  });
});

describe("Pane (audit n° 20)", () => {
  it("is named by its title, with its tools, buttons, body and foot", () => {
    render(
      <Pane title="Documents" tools={<span>3</span>} actions={<button type="button">Close</button>} footer="foot">
        body
      </Pane>,
    );
    const pane = screen.getByRole("region", { name: "Documents" });
    expect(within(pane).getByRole("heading", { name: "Documents" })).toBeInTheDocument();
    expect(within(pane).getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(pane).toHaveTextContent("body");
    expect(pane).toHaveTextContent("foot");
  });

  it("an aside without a title is named by its label", () => {
    render(
      <Pane as="aside" label="Jobs">
        x
      </Pane>,
    );
    expect(screen.getByRole("complementary", { name: "Jobs" })).toBeInTheDocument();
  });
});

describe("Tile and Logo (audit n° 41, 45)", () => {
  it("a tile shows two initials or an icon, read out only with a label", () => {
    const { container } = render(
      <>
        <Tile initials="RSX" tone="accent" />
        <Tile icon="claude" tone="claude" label="Claude run" />
      </>,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toHaveTextContent("RS");
    expect(screen.getByRole("img", { name: "Claude run" })).toBeInTheDocument();
  });

  it("the logo is read out only where it names the app", () => {
    const { rerender } = render(<Logo label="Testimus" />);
    expect(screen.getByRole("img", { name: "Testimus" })).toHaveAttribute("src", "/logo.png");
    rerender(<Logo />);
    expect(screen.queryByRole("img", { name: "Testimus" })).toBeNull();
  });
});
