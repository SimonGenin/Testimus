// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { videoPreview } from "../../../../src/ui/components/sources/VideoPreview.tsx";
import { SourceChip } from "../../../../src/ui/components/ui/SourceChip.tsx";
import { StepSource } from "../../../../src/ui/screens/tests/step/StepSource.tsx";
import { callsOf, dataWrapper, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

const frame = (at: number, anchor: string, description: string) => ({
  at,
  anchor,
  figure: `figures/frame-1-${at}.jpg`,
  why: "",
  description,
  fixed: false,
});

const FRAMES = [
  frame(120, "frame:02:00", "Le synoptique, le sectionneur S12 fermé."),
  frame(164, "frame:02:44", "Le bandeau d'alarmes affiche le refus de manœuvre."),
  frame(230, "frame:03:50", "L'alarme est acquittée."),
];

const LINES = [
  { anchor: "t:02:28", at: 148, end: 155, text: "La fenêtre Propriétés indique un sectionneur fermé." },
  { anchor: "t:02:36", at: 156, end: 166, text: "On demande l'autorisation : le message de refus apparaît." },
  { anchor: "t:02:47", at: 167, end: 172, text: "Bon, refermez maintenant." },
];

beforeEach(() => {
  fakeNet();
  fakeEvents();
  net.routes["docs.list"] = () => [];
  net.routes["media.show"] = () => ({
    doc: "FILM",
    type: "video",
    observed: true,
    images: [],
    videos: [{ n: 1, name: "manoeuvre.mp4", file: "files/manoeuvre.mp4", duration: 260, keyFrames: FRAMES }],
  });
  net.routes["media.transcript"] = () => ({ doc: "FILM", video: 1, duration: 260, transcribed: true, lines: LINES });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setProject(null);
});

// ponytail: the tooltip waits half a second under the pointer; the reads that follow go on real time
function hover(chip: HTMLElement) {
  vi.useFakeTimers();
  fireEvent.mouseEnter(chip.parentElement as HTMLElement);
  act(() => {
    vi.advanceTimersByTime(500);
  });
  vi.useRealTimers();
}
const tip = () => document.querySelector('[role="tooltip"]') as HTMLElement;
const picture = () => document.querySelector('[role="tooltip"] img');
const reads = () => net.calls.filter((c) => c.name.startsWith("media."));

describe("the preview of a video source, on hover", () => {
  it("is asked for a source in a video only", () => {
    expect(
      ["t:02:36", "t:02:36..02:52", "v:02:36..02:52", "frame:02:44", "t:2/00:10"].map(
        (anchor) => !!videoPreview({ docId: "FILM", anchor }),
      ),
    ).toEqual([true, true, true, true, true]);
    expect(["§5.6", "fig:4", "img:2"].map((anchor) => videoPreview({ docId: "SPEC", anchor }))).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("reads nothing until the chip is hovered, then shows the key frame of the range and the first line it cites", async () => {
    const s = { docId: "FILM", anchor: "t:02:36..02:52", quote: "le message de refus apparaît" };
    render(<SourceChip reference="FILM 02:36 → 02:52" quote={s.quote} preview={videoPreview(s)} onOpen={() => {}} />);
    const chip = screen.getByRole("button", { name: /FILM 02:36/ });
    expect(chip).toHaveAccessibleDescription("FILM 02:36 → 02:52 — “le message de refus apparaît”");
    expect(picture()).toBeNull();
    expect(reads()).toEqual([]);
    hover(chip);
    await waitFor(() => expect(picture()).not.toBeNull());
    expect(picture()?.getAttribute("src")).toMatch(/^\/files\/docs\/FILM\/figures\/frame-1-164\.jpg/);
    expect(picture()).toHaveAttribute("alt", "");
    expect(
      await within(tip()).findByText(/On demande l'autorisation : le message de refus apparaît\./),
    ).toHaveTextContent("02:36 On demande l'autorisation : le message de refus apparaît.");
    expect(tip()).toHaveTextContent("FILM 02:36 → 02:52 — “le message de refus apparaît”");
    expect(callsOf("media.show").map((c) => c.input)).toEqual([{ doc: "FILM" }]);
    expect(callsOf("media.transcript").map((c) => c.input)).toEqual([
      { doc: "FILM", video: 1, from: "136", to: "202" },
    ]);
    fireEvent.mouseLeave(chip.parentElement as HTMLElement);
    expect(picture()).toBeNull();
  });

  it("a moment shows the key frame nearest to it and the line being said then", async () => {
    const s = { docId: "FILM", anchor: "t:02:50", quote: "" };
    render(<SourceChip reference="FILM 02:50" preview={videoPreview(s)} onOpen={() => {}} />);
    hover(screen.getByRole("button", { name: "FILM 02:50" }));
    await waitFor(() => expect(picture()?.getAttribute("src")).toMatch(/frame-1-164\.jpg/));
    expect(await within(tip()).findByText(/Bon, refermez maintenant\./)).toHaveTextContent(
      "02:47 Bon, refermez maintenant.",
    );
  });

  it("what is seen shows the key frame and its description, and never reads the transcript", async () => {
    const s = { docId: "FILM", anchor: "v:03:40..04:00", quote: "L'alarme est acquittée" };
    render(<SourceChip reference="FILM Seen 03:40 → 04:00" compact preview={videoPreview(s)} onOpen={() => {}} />);
    hover(screen.getByRole("button", { name: "FILM Seen 03:40 → 04:00" }));
    await waitFor(() => expect(picture()?.getAttribute("src")).toMatch(/frame-1-230\.jpg/));
    expect(within(tip()).getByText(/L'alarme est acquittée\./)).toHaveTextContent("03:50 L'alarme est acquittée.");
    expect(callsOf("media.transcript")).toEqual([]);
    cleanup();
    const far = { docId: "FILM", anchor: "v:00:10..00:20", quote: "" };
    render(<SourceChip reference="FILM Seen 00:10 → 00:20" preview={videoPreview(far)} onOpen={() => {}} />);
    hover(screen.getByRole("button", { name: "FILM Seen 00:10 → 00:20" }));
    await waitFor(() => expect(picture()?.getAttribute("src")).toMatch(/frame-1-120\.jpg/));
    expect(within(tip()).queryByText(/Le synoptique/)).toBeNull();
  });

  it("a video that cannot be shown leaves the tooltip its words", async () => {
    net.routes["media.show"] = () => {
      throw new Error("No document FILM");
    };
    const s = { docId: "FILM", anchor: "t:02:36", quote: "" };
    render(<SourceChip reference="FILM 02:36" preview={videoPreview(s)} onOpen={() => {}} />);
    hover(screen.getByRole("button", { name: "FILM 02:36" }));
    await waitFor(() => expect(callsOf("media.show")).toHaveLength(1));
    expect(picture()).toBeNull();
    expect(tip()).toHaveTextContent("FILM 02:36");
  });

  it("a step's chip gives it for a video source, and a source in a text costs nothing", async () => {
    render(
      <>
        <StepSource source={{ docId: "FILM", anchor: "frame:02:44", quote: "" }} onOpen={() => {}} />
        <StepSource source={{ docId: "SPEC", anchor: "§5.6", quote: "Le menu propose Propriétés" }} onOpen={() => {}} />
      </>,
    );
    const text = screen.getByRole("button", { name: /SPEC/ });
    hover(text);
    expect(picture()).toBeNull();
    expect(reads()).toEqual([]);
    fireEvent.mouseLeave(text.parentElement as HTMLElement);
    hover(screen.getByRole("button", { name: /FILM/ }));
    await waitFor(() => expect(picture()?.getAttribute("src")).toMatch(/frame-1-164\.jpg/));
    expect(callsOf("media.show")).toHaveLength(1);
    expect(callsOf("media.transcript")).toEqual([]);
  });
});
