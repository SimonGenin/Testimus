// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { PassageDialog } from "../../../../src/ui/components/sources/PassageDialog.tsx";
import { isVideoSource } from "../../../../src/ui/components/sources/VideoSource.tsx";
import { sourceLabel } from "../../../../src/ui/lib/fields.ts";
import { callsOf, dataWrapper, fakeEvents, fakeNet, net } from "../../helpers/ui-data.tsx";

const render = ((ui: Parameters<typeof rtlRender>[0], o?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: dataWrapper(), ...o })) as typeof rtlRender;

const LINES = [
  { anchor: "t:02:28", at: 148, end: 155, text: "La fenêtre Propriétés indique un sectionneur fermé." },
  { anchor: "t:02:36", at: 156, end: 166, text: "On demande l'autorisation : le message de refus apparaît." },
  {
    anchor: "t:02:47",
    at: 167,
    end: 172,
    text: "So, dann bitte wieder schließen.",
    lang: "de",
    translation: "Bon, refermez maintenant.",
  },
  { anchor: "t:02:55", at: 175, end: 180, text: "On acquitte l'alarme." },
];

beforeEach(() => {
  fakeNet();
  fakeEvents();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  net.routes["media.show"] = () => ({
    doc: "FILM",
    type: "video",
    observed: true,
    images: [],
    videos: [
      {
        n: 1,
        name: "manoeuvre.mp4",
        file: "files/manoeuvre.mp4",
        duration: 260,
        transcribed: true,
        lines: 4,
        unsure: 0,
        fixed: 0,
        audio: true,
        tracks: [{}],
        languages: { fr: 200 },
        subtitles: { said: "video/1/said.vtt" },
        report: false,
        chapters: [{ at: 0, title: "Ouverture" }],
        keyFrames: [
          {
            at: 164,
            anchor: "frame:02:44",
            figure: "figures/frame-1-164.jpg",
            why: "Le refus",
            description: "Le bandeau d'alarmes affiche le refus de manœuvre, le voyant devient rouge.",
            fixed: false,
          },
        ],
      },
    ],
  });
  net.routes["media.transcript"] = () => ({ doc: "FILM", video: 1, duration: 260, transcribed: true, lines: LINES });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setProject(null);
});

const player = () => screen.getByLabelText("Video manoeuvre.mp4") as HTMLVideoElement;

describe("a source in a video", () => {
  it("is told from any other source, and named by its moment or its range", () => {
    expect(
      ["t:02:36", "t:02:36..02:52", "v:02:36..02:52", "frame:02:44", "§5.6", "fig:4", "img:2"].map(isVideoSource),
    ).toEqual([true, true, true, true, false, false, false]);
    expect(sourceLabel({ docId: "FILM", anchor: "t:02:36..02:52" })).toBe("FILM 02:36 → 02:52");
    expect(sourceLabel({ docId: "FILM", anchor: "v:02:36..02:52" })).toBe("FILM Seen 02:36 → 02:52");
  });

  it("plays the range it cites in a loop with its margins, the cited lines lit and the quote marked — no passage is read", async () => {
    render(
      <PassageDialog
        frame="tab"
        source={{ docId: "FILM", anchor: "t:02:36..02:52", quote: "le message de refus apparaît" }}
        onClose={() => {}}
      />,
    );
    const said = await screen.findByRole("list", { name: "What is said" });
    expect(player().getAttribute("src")).toMatch(/docs\/FILM\/files\/manoeuvre\.mp4.*#t=152$/);
    expect(screen.getByRole("button", { name: "Loop" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/cited 02:36 → 02:52/)).toBeInTheDocument();
    const lit = within(said)
      .getAllByRole("listitem")
      .filter((li) => li.getAttribute("aria-current") === "true");
    expect(lit.map((li) => within(li).getByText(/^\d\d:\d\d$/).textContent)).toEqual(["02:36", "02:47"]);
    expect(within(said).getByText("le message de refus apparaît").tagName).toBe("MARK");
    expect(within(said).getByText("DE · Bon, refermez maintenant.")).toBeInTheDocument();
    expect(callsOf("rag.passage")).toEqual([]);
    expect(callsOf("media.transcript")[0]?.input).toEqual({ doc: "FILM", video: 1, from: "136", to: "202" });
  });

  it("a moment alone cites the line being said then, up to the next one", async () => {
    render(<PassageDialog frame="tab" source={{ docId: "FILM", anchor: "t:02:40", quote: "" }} onClose={() => {}} />);
    await screen.findByRole("list", { name: "What is said" });
    expect(await screen.findByText(/cited 02:36 → 02:47/)).toBeInTheDocument();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  it("a range plays in its loop as soon as its source is opened, and the next range opened plays too", async () => {
    const { rerender } = render(
      <PassageDialog frame="tab" source={{ docId: "FILM", anchor: "t:02:36..02:52", quote: "" }} onClose={() => {}} />,
    );
    await screen.findByRole("list", { name: "What is said" });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(vi.mocked(HTMLMediaElement.prototype.play).mock.contexts[0]).toBe(player());
    expect(screen.getByRole("button", { name: "Loop" })).toHaveAttribute("aria-pressed", "true");
    rerender(
      <PassageDialog frame="tab" source={{ docId: "FILM", anchor: "v:00:40..00:50", quote: "" }} onClose={() => {}} />,
    );
    expect(await screen.findByText(/cited 00:40 → 00:50/)).toBeInTheDocument();
    expect(player().currentTime).toBe(36);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  it("a play the browser refuses leaves the source open and paused, with nothing said about it", async () => {
    vi.mocked(HTMLMediaElement.prototype.play).mockImplementation(() =>
      Promise.reject(new DOMException("play() needs a gesture", "NotAllowedError")),
    );
    render(
      <PassageDialog frame="tab" source={{ docId: "FILM", anchor: "t:02:36..02:52", quote: "" }} onClose={() => {}} />,
    );
    await screen.findByRole("list", { name: "What is said" });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/could not/i)).toBeNull();
  });

  it("plays the project's margin around the range (project.json video.margin), 4 s when it has none", async () => {
    net.routes["project.info"] = () => ({ dir: "P", project: { name: "P", video: { margin: 10 } }, xray: {} });
    render(
      <PassageDialog frame="tab" source={{ docId: "FILM", anchor: "t:02:36..02:52", quote: "" }} onClose={() => {}} />,
    );
    await screen.findByRole("list", { name: "What is said" });
    expect(player().getAttribute("src")).toMatch(/#t=146$/);
    expect(screen.getByText("margin 10 s")).toBeInTheDocument();
    expect(screen.getByText("Loop · 02:26 – 03:02")).toBeInTheDocument();
    cleanup();
    net.routes["project.info"] = () => ({ dir: "P", project: { name: "P" }, xray: {} });
    render(
      <PassageDialog frame="tab" source={{ docId: "FILM", anchor: "t:02:36..02:52", quote: "" }} onClose={() => {}} />,
    );
    await screen.findByRole("list", { name: "What is said" });
    expect(player().getAttribute("src")).toMatch(/#t=152$/);
    expect(screen.getByText("margin 4 s")).toBeInTheDocument();
  });

  it("a recording of sound alone is played without a picture", async () => {
    const show = net.routes["media.show"];
    net.routes["media.show"] = (input) => {
      const shown = show(input) as { videos: Record<string, unknown>[] };
      return { ...shown, videos: shown.videos.map((v) => ({ ...v, sound: true, keyFrames: [] })) };
    };
    render(
      <PassageDialog frame="tab" source={{ docId: "FILM", anchor: "t:02:36..02:52", quote: "" }} onClose={() => {}} />,
    );
    await screen.findByRole("list", { name: "What is said" });
    expect(screen.getByText("Sound only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Full screen" })).toBeNull();
    expect(screen.getByRole("button", { name: "Loop" })).toHaveAttribute("aria-pressed", "true");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  it("what is seen shows the key frames of the range with what each shows", async () => {
    render(
      <PassageDialog
        frame="tab"
        source={{ docId: "FILM", anchor: "v:02:36..02:52", quote: "le voyant devient rouge" }}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText("What is seen")).toBeInTheDocument();
    expect(screen.getByText("le voyant devient rouge").tagName).toBe("MARK");
    cleanup();
    render(
      <PassageDialog frame="tab" source={{ docId: "FILM", anchor: "v:00:10..00:20", quote: "x" }} onClose={() => {}} />,
    );
    expect(await screen.findByText(/No key frame falls in this range/)).toBeInTheDocument();
  });

  it("opened from a step, its bounds are moved and the source is written back to the test", async () => {
    net.routes["tests.edit"] = () => "T-1";
    const other = {
      docId: "SPEC",
      anchor: "§5.6",
      quote: "Le menu propose Propriétés",
      column: "Action",
      item: "Clic droit",
    };
    const mine = { docId: "FILM", anchor: "t:02:36..02:52", quote: "le message de refus apparaît" };
    render(
      <PassageDialog
        frame="tab"
        source={mine}
        from={{ test: "T-1", step: 4, sources: [other, mine] }}
        onClose={() => {}}
      />,
    );
    const end = await screen.findByRole("slider", { name: "End of the cited range" });
    fireEvent.keyDown(end, { key: "ArrowRight" });
    fireEvent.keyUp(end, { key: "ArrowRight" });
    expect(await screen.findByText("Range moved to 02:36 → 02:53")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save the range" }));
    await waitFor(() =>
      expect(callsOf("tests.edit")[0]?.input).toEqual({
        id: "T-1",
        steps: [
          {
            op: "sources",
            step: 4,
            sources: [
              'SPEC#§5.6 "Le menu propose Propriétés" @Action "Clic droit"',
              'FILM#t:02:36..02:53 "le message de refus apparaît"',
            ],
          },
        ],
      }),
    );
  });

  it("without a step to write to, the range cannot be moved", async () => {
    render(
      <PassageDialog frame="tab" source={{ docId: "FILM", anchor: "t:02:36..02:52", quote: "" }} onClose={() => {}} />,
    );
    await screen.findByRole("list", { name: "What is said" });
    expect(screen.queryByRole("slider", { name: "End of the cited range" })).toBeNull();
  });

  it("a PC that cannot play the original asks for a lighter copy", async () => {
    net.routes["media.lighten"] = () => ({ file: "video/1/light.mp4" });
    render(<PassageDialog frame="tab" source={{ docId: "FILM", anchor: "t:02:36", quote: "" }} onClose={() => {}} />);
    await screen.findByRole("list", { name: "What is said" });
    Object.defineProperty(player(), "error", { value: { code: 4 }, configurable: true });
    fireEvent.error(player());
    await waitFor(() => expect(callsOf("media.lighten")[0]?.input).toEqual({ doc: "FILM", video: 1 }));
  });
});
