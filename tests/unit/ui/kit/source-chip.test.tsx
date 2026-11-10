// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SourceChip } from "../../../../src/ui/components/ui/SourceChip.tsx";

afterEach(cleanup);

const cls = (el: Element) => el.getAttribute("class") ?? "";
const QUOTE = "Selon le type de sectionneur, le menu contextuel diffère";

let mounted = 0;
function Seen() {
  mounted++;
  return <span data-testid="seen">02:44 Le voyant devient rouge</span>;
}

describe("SourceChip", () => {
  it("is a button with the reference and the quote that opens the passage", () => {
    const onOpen = vi.fn();
    render(<SourceChip reference="§5.6.6" quote={QUOTE} onOpen={onOpen} />);
    const b = screen.getByRole("button", { name: `§5.6.6 “${QUOTE}”` });
    expect(b).toHaveAttribute("type", "button");
    expect(b).toHaveAccessibleDescription(`§5.6.6 — “${QUOTE}”`);
    fireEvent.click(b);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("sets the reference and the quote in their own faces", () => {
    render(<SourceChip reference="§5.6.6" quote={QUOTE} onOpen={() => {}} />);
    const ref = screen.getByText("§5.6.6");
    const quote = screen.getByText(`“${QUOTE}”`);
    expect(cls(ref)).not.toBe(cls(quote));
    expect(cls(ref)).not.toBe("");
  });

  it("without onOpen it is only read; compact shows the reference alone with the quote in its tooltip", () => {
    render(
      <>
        <SourceChip reference="§4.1" quote="La fenêtre affiche l'état" />
        <SourceChip reference="§4.2" quote="Le menu propose" compact onOpen={() => {}} />
      </>,
    );
    expect(screen.queryByRole("button", { name: /§4\.1/ })).toBeNull();
    expect(screen.getByText("§4.1")).toBeVisible();
    const compact = screen.getByRole("button", { name: "§4.2" });
    expect(compact).not.toHaveTextContent("Le menu propose");
    expect(compact).toHaveAccessibleDescription("§4.2 — “Le menu propose”");
  });

  it("a figure shows the image icon instead of the quote mark", () => {
    render(
      <>
        <SourceChip reference="fig:40" quote="Figure 40" figure onOpen={() => {}} />
        <SourceChip reference="§1" quote="Texte" onOpen={() => {}} />
      </>,
    );
    const svg = (name: RegExp) => screen.getByRole("button", { name }).querySelector("svg")?.innerHTML;
    expect(svg(/fig:40/)).not.toBe(svg(/§1/));
  });

  it("the passage open now is pressed", () => {
    render(
      <>
        <SourceChip reference="§1" quote="a" pressed onOpen={() => {}} />
        <SourceChip reference="§2" quote="a" pressed={false} onOpen={() => {}} />
      </>,
    );
    expect(screen.getByRole("button", { name: /§1/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /§2/ })).toHaveAttribute("aria-pressed", "false");
    expect(cls(screen.getByRole("button", { name: /§1/ }))).not.toBe(cls(screen.getByRole("button", { name: /§2/ })));
  });

  it("not found and not at its anchor say so in words and look apart", () => {
    render(
      <>
        <SourceChip reference="§1" quote="ok" onOpen={() => {}} />
        <SourceChip reference="§2" quote="gone" state="not-found" onOpen={() => {}} />
        <SourceChip reference="§3" quote="moved" state="not-at-anchor" onOpen={() => {}} />
      </>,
    );
    const ok = screen.getByRole("button", { name: "§1 “ok”" });
    const gone = screen.getByRole("button", { name: "Not found §2 “gone”" });
    const moved = screen.getByRole("button", { name: "Not at its anchor §3 “moved”" });
    expect(gone).toHaveAccessibleDescription("§2 — “gone” The quote is not in the document.");
    expect(moved).toHaveAccessibleDescription("§3 — “moved” The quote is in the document, but not at this anchor.");
    expect(new Set([cls(ok), cls(gone), cls(moved)]).size).toBe(3);
  });

  it("the catalogue can show hover and focus", () => {
    render(
      <>
        <SourceChip reference="§1" onOpen={() => {}} />
        <SourceChip reference="§2" onOpen={() => {}} debugState="hover" />
        <SourceChip reference="§3" onOpen={() => {}} debugState="focus" />
      </>,
    );
    const c = (n: string) => cls(screen.getByRole("button", { name: n }));
    expect(new Set([c("§1"), c("§2"), c("§3")]).size).toBe(3);
  });

  it("a preview is mounted above the tooltip's words only while the chip is hovered; without one nothing is added", () => {
    vi.useFakeTimers();
    try {
      mounted = 0;
      render(
        <>
          <SourceChip reference="FILM 02:36" quote="le refus" preview={<Seen />} onOpen={() => {}} />
          <SourceChip reference="§5.6.6" quote={QUOTE} onOpen={() => {}} />
        </>,
      );
      const film = screen.getByRole("button", { name: "FILM 02:36 “le refus”" });
      const text = screen.getByRole("button", { name: `§5.6.6 “${QUOTE}”` });
      const bubble = (chip: HTMLElement) => chip.parentElement?.querySelector('[role="tooltip"]') as HTMLElement;
      expect(mounted).toBe(0);
      expect(film).toHaveAccessibleDescription("FILM 02:36 — “le refus”");
      expect(bubble(text).childNodes).toHaveLength(1);
      fireEvent.mouseEnter(film.parentElement as HTMLElement);
      act(() => {
        vi.advanceTimersByTime(499);
      });
      expect(screen.queryByTestId("seen")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(bubble(film)).toContainElement(screen.getByTestId("seen"));
      expect(bubble(film).firstChild).toBe(screen.getByTestId("seen"));
      expect(bubble(film)).toHaveTextContent("FILM 02:36 — “le refus”");
      expect(cls(bubble(film))).not.toBe(cls(bubble(text)));
      fireEvent.mouseLeave(film.parentElement as HTMLElement);
      expect(screen.queryByTestId("seen")).toBeNull();
      fireEvent.mouseEnter(text.parentElement as HTMLElement);
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(bubble(text).childNodes).toHaveLength(1);
      expect(bubble(text)).toHaveTextContent(`§5.6.6 — “${QUOTE}”`);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows a quote without doc.md's bold and italic marks, and keeps a lone star", () => {
    render(
      <>
        <SourceChip reference="§5.6.6" quote="ne propose que **Propriétés**." onOpen={() => {}} />
        <SourceChip reference="§5.6.7" quote="le *Disjoncteur* et la note 2 * 3" />
      </>,
    );
    const b = screen.getByRole("button", { name: "§5.6.6 “ne propose que Propriétés.”" });
    expect(b).toHaveAccessibleDescription("§5.6.6 — “ne propose que Propriétés.”");
    expect(screen.getByText("“le Disjoncteur et la note 2 * 3”")).toBeInTheDocument();
    expect(screen.queryByText(/\*\*/)).toBeNull();
  });
});
