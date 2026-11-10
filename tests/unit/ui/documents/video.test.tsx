// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaFile } from "../../../../src/core/types.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { DocumentsScreen } from "../../../../src/ui/screens/documents/DocumentsScreen.tsx";
import { api, FakeEventSource, fakeFetch, named, noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { doc, mountDocs } from "./helpers.tsx";

const film: MediaFile = {
  n: 1,
  name: "manoeuvre.mp4",
  file: "files/manoeuvre.mp4",
  kind: "video",
  sha256: "x",
  state: "analysed",
  duration: 160,
};
const video = doc("FILM", {
  title: "Manœuvre au PCC",
  kind: "other",
  type: "video",
  observed: true,
  source: { type: "video", name: "manoeuvre.mp4", file: "files", sha256: "", files: [film] },
});

const summary = (over: Record<string, unknown> = {}) => ({
  n: 1,
  name: "manoeuvre.mp4",
  file: "files/manoeuvre.mp4",
  duration: 160,
  transcribed: true,
  lines: 3,
  unsure: 1,
  fixed: 0,
  audio: true,
  tracks: [{}, { title: "PC sound" }],
  with: "Whisper large-v3 turbo (8-bit)",
  device: "gpu",
  languages: { fr: 120, de: 12 },
  subtitles: { said: "video/1/said.vtt", translated: "video/1/translated.vtt" },
  report: false,
  chapters: [
    { at: 0, title: "Ouverture du poste" },
    { at: 40, title: "Menu contextuel" },
  ],
  keyFrames: [
    {
      at: 80,
      anchor: "frame:01:20",
      figure: "figures/frame-1-80.jpg",
      why: "Le menu ouvert",
      description: "Le menu contextuel s'ouvre.",
      fixed: false,
    },
  ],
  ...over,
});

const LINES = [
  { anchor: "t:00:02", at: 2, end: 14, text: "Bonjour, on ouvre le poste.", lang: "fr", p: 0.94 },
  {
    anchor: "t:00:32",
    at: 32,
    end: 44,
    text: "Là on fait clic droit sur le section heure.",
    lang: "fr",
    p: 0.5,
    unsure: true,
  },
  {
    anchor: "t:00:47",
    at: 47,
    end: 59,
    text: "So, dann bitte wieder schließen.",
    lang: "de",
    translation: "Bon, refermez maintenant.",
  },
];

function serve(over: Record<string, unknown> = {}, proposals: unknown[] = []) {
  api.routes["docs.list"] = () => [video];
  api.routes["docs.show"] = (i) =>
    i.anchor
      ? { md: "", section: "§media" }
      : {
          doc: video,
          type: "video",
          observed: true,
          context: "",
          contextMtime: null,
          contexts: [],
          toc: [{ anchor: "§media", title: video.title, level: 0 }],
          figures: [],
          md: "",
        };
  api.routes["media.show"] = () => ({
    doc: "FILM",
    type: "video",
    observed: true,
    images: [],
    videos: [summary(over)],
  });
  api.routes["media.transcript"] = () => ({ doc: "FILM", video: 1, duration: 160, transcribed: true, lines: LINES });
  api.routes["media.proposals"] = () => ({ doc: "FILM", video: 1, proposals });
  api.routes["media.glossary"] = () => ({
    terms: [],
    kept: [],
    auto: true,
    prompt: "",
    tokens: 0,
    budget: 170,
    heard: [],
    languages: [
      { code: "fr", name: "French", quality: "best" },
      { code: "de", name: "German", quality: "best" },
    ],
  });
  api.routes["media.estimate"] = () => ({
    duration: 160,
    bytes: 4_000_000,
    audio: true,
    tracks: 2,
    model: "Whisper large-v3 turbo (8-bit)",
    device: "gpu",
    speechSeconds: 5,
    measured: true,
    framesSeconds: 26,
    seconds: 31,
    claude: { runs: 4, images: 8 },
    long: false,
    disk: { needMB: 12, freeMB: 90_000 },
  });
}

const player = () => screen.getByLabelText("Video manoeuvre.mp4") as HTMLVideoElement;
const said = () => screen.findByRole("list", { name: "What is said" });
const lineOf = async (text: RegExp) => (await within(await said()).findByText(text)).closest("li") as HTMLElement;

beforeEach(() => {
  fakeFetch();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(async () => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  setProject(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the Video view of a document", () => {
  it("plays the video with what is said beside it: a line, a chapter and a key frame go to their moment", async () => {
    serve();
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM#t:00:32" } });
    const list = await said();
    expect(player().getAttribute("src")).toMatch(/files\/docs\/FILM\/files\/manoeuvre\.mp4.*#t=32$/);
    expect(
      screen.getByText(/French 2 min · German 12 s · heard by Whisper large-v3 turbo \(8-bit\) on the graphics card/),
    ).toBeInTheDocument();
    expect(screen.getByText("Transcript · 3 lines · 1 to listen to")).toBeInTheDocument();
    await waitFor(async () => expect(await lineOf(/clic droit/)).toHaveAttribute("aria-current", "true"));
    fireEvent.click(within(list).getByRole("button", { name: "00:02" }));
    expect(player().currentTime).toBe(2);
    fireEvent.click(within(list).getByRole("button", { name: "Menu contextuel" }));
    expect(player().currentTime).toBe(40);
    const frames = screen.getByRole("list", { name: "Key frames" });
    expect(within(frames).getByText("Le menu contextuel s'ouvre.")).toBeInTheDocument();
    fireEvent.click(within(frames).getByRole("button", { name: /frame:01:20/ }));
    expect(player().currentTime).toBe(80);
    expect(within(await lineOf(/wieder schließen/)).getByText("DE · Bon, refermez maintenant.")).toBeInTheDocument();
  });

  it("a link to a range opens the player on it, in a loop", async () => {
    serve();
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM#t:00:32..00:50" } });
    await said();
    expect(player().getAttribute("src")).toMatch(/#t=28$/);
    expect(screen.getByRole("button", { name: /Loop/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/cited 00:32 → 00:50/)).toBeInTheDocument();
  });

  it("a line the engine doubted is confirmed or corrected after listening, and can be given back", async () => {
    serve();
    api.routes["media.fix"] = () => ({ doc: "FILM", video: 1, cited: 0 });
    api.routes["media.unfix"] = () => ({ doc: "FILM", video: 1, cited: 0 });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    const line = await lineOf(/section heure/);
    expect(within(line).getByText("Unsure")).toBeInTheDocument();
    fireEvent.click(within(line).getByRole("button", { name: "Listen" }));
    expect(player().currentTime).toBe(28);
    fireEvent.click(within(line).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(named("media.fix")[0]?.input).toEqual({ doc: "FILM", video: 1, at: "32", index: true }));
    fireEvent.click(within(line).getByRole("button", { name: "Correct" }));
    const field = within(line).getByRole("textbox", { name: "What is said at 00:32" });
    fireEvent.change(field, { target: { value: "Là on fait clic droit sur le sectionneur." } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() =>
      expect(named("media.fix")[1]?.input).toEqual({
        doc: "FILM",
        video: 1,
        at: "32",
        text: "Là on fait clic droit sur le sectionneur.",
        index: true,
      }),
    );
    cleanup();
    api.routes["media.transcript"] = () => ({
      doc: "FILM",
      video: 1,
      duration: 160,
      transcribed: true,
      lines: [{ ...LINES[1], text: "Là on fait clic droit sur le sectionneur.", unsure: undefined, by: "human" }],
    });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    const fixed = await lineOf(/sectionneur/);
    expect(within(fixed).getByText("Checked by a person")).toBeInTheDocument();
    expect(within(fixed).queryByText("Unsure")).toBeNull();
    fireEvent.click(within(fixed).getByRole("button", { name: "Give back" }));
    await waitFor(() =>
      expect(named("media.unfix")[0]?.input).toEqual({ doc: "FILM", video: 1, at: "32", index: true }),
    );
  });

  it("Claude's proposal shows its clue and waits: accepted or refused by a person", async () => {
    serve({}, [
      {
        id: "32",
        from: 32,
        to: 44,
        heard: LINES[1].text,
        text: "Là on fait clic droit sur le sectionneur.",
        clue: "glossary",
        why: "Le glossaire nomme le sectionneur.",
      },
    ]);
    api.routes["media.decide"] = () => ({ doc: "FILM", video: 1, cited: 0 });
    api.routes["media.propose"] = () => ({ doc: "FILM", video: 1, proposals: [] });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    const line = await lineOf(/section heure/);
    expect(within(line).getByText("Claude proposes · from the glossary")).toBeInTheDocument();
    expect(within(line).getByText("Le glossaire nomme le sectionneur.")).toBeInTheDocument();
    fireEvent.click(within(line).getByRole("button", { name: "Accept" }));
    await waitFor(() =>
      expect(named("media.decide")[0]?.input).toEqual({ doc: "FILM", video: 1, id: "32", accept: true, index: true }),
    );
    fireEvent.click(within(line).getByRole("button", { name: "Refuse" }));
    await waitFor(() => expect(named("media.decide")[1]?.input).toMatchObject({ accept: false }));
    fireEvent.click(screen.getByRole("button", { name: "Propose corrections" }));
    await waitFor(() => expect(named("media.propose")[0]?.input).toEqual({ doc: "FILM", video: 1 }));
  });

  it("a key frame's description is corrected by a person, and any second is kept as a key frame", async () => {
    serve();
    api.routes["media.describe"] = () => ({ anchor: "frame:01:20", description: "x", fixed: true, cited: 0 });
    api.routes["media.keep"] = () => ({ anchor: "frame:00:00", at: 0, figure: "f", description: "", added: true });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    const frames = await screen.findByRole("list", { name: "Key frames" });
    fireEvent.click(within(frames).getByRole("button", { name: "Correct" }));
    const field = within(frames).getByRole("textbox", { name: "What the frame at 01:20 shows" });
    fireEvent.change(field, { target: { value: "Le menu ne propose que Propriétés." } });
    fireEvent.click(within(frames).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(named("media.describe")[0]?.input).toEqual({
        doc: "FILM",
        video: 1,
        at: "80",
        text: "Le menu ne propose que Propriétés.",
        index: true,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Keep the frame at/ }));
    await waitFor(() => expect(named("media.keep")[0]?.input).toMatchObject({ doc: "FILM", video: 1 }));
    expect(await screen.findByText("Key frame kept")).toBeInTheDocument();
  });

  it("« Hear again… » keeps what is heard of the video, says what it costs, and hears it again", async () => {
    serve();
    api.routes["media.set"] = () => film;
    api.routes["media.retranscribe"] = () => ({ doc: "FILM", video: 1, lines: 3, with: "x", warnings: [] });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    fireEvent.click(await screen.findByRole("button", { name: "Hear again…" }));
    const dialog = await screen.findByRole("dialog", { name: "Hear the video again" });
    expect(
      await within(dialog).findByText(/about a minute to hear it on the graphics card.*measured here/),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("About 4 runs, 8 pictures")).toBeInTheDocument();
    fireEvent.change(within(dialog).getByRole("textbox", { name: "From" }), { target: { value: "00:30" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "To" }), { target: { value: "01:00" } });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Hear every piece again" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Hear again" }));
    await waitFor(() =>
      expect(named("media.set")[0]?.input).toEqual({
        doc: "FILM",
        video: 1,
        spoken: [],
        allTracks: true,
        from: "00:30",
        to: "01:00",
      }),
    );
    await waitFor(() =>
      expect(named("media.retranscribe")[0]?.input).toEqual({ doc: "FILM", video: 1, all: true, index: true }),
    );
  });

  it("a video heard again shows its report: applied, or the transcript before put back", async () => {
    serve({ report: true });
    api.routes["media.report"] = () => ({
      report: {
        doc: "FILM",
        video: 1,
        at: "2026-11-10T10:00:00.000Z",
        before: { with: "Whisper small (8-bit)", at: "2026-11-09T10:00:00.000Z" },
        holds: 1,
        moved: 1,
        lost: 1,
        rows: [
          { test: "T-1", step: 2, from: "FILM#t:00:02", quote: "on ouvre le poste", state: "holds" },
          { test: "T-1", step: 3, from: "FILM#t:00:32", quote: "clic droit", state: "moved", to: "FILM#t:00:36" },
          {
            test: "T-2",
            step: 1,
            from: "FILM#t:00:47",
            quote: "sans télécommande",
            state: "lost",
            nearest: { anchor: "t:00:51", text: "un sectionneur manuel" },
          },
        ],
      },
    });
    api.routes["media.applyReport"] = (i) => ({ rewritten: [], lost: 1, undone: !!i.undo });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    expect(
      await screen.findByText(
        /1 source holds, 1 follows its words, 1 no longer finds its\. The transcript before \(Whisper small \(8-bit\)\) is kept/,
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See the report" }));
    const dialog = await screen.findByRole("dialog", { name: "What the new transcription changes" });
    expect(within(dialog).getByText("00:32 → 00:36")).toBeInTheDocument();
    expect(within(dialog).getByText("Closest now, at 00:51: « un sectionneur manuel »")).toBeInTheDocument();
    expect(within(dialog).getByText("Words not found")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(named("media.applyReport")[0]?.input).toEqual({ doc: "FILM", video: 1, undo: false, index: true }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Put the old one back" }));
    await waitFor(() => expect(named("media.applyReport")[1]?.input).toMatchObject({ undo: true }));
  });

  it("says why a video has no transcript, and plays the lighter copy when there is one", async () => {
    serve({ transcribed: false, lines: 0, languages: {}, with: undefined, light: "video/1/light.mp4" });
    api.routes["media.transcript"] = () => ({ doc: "FILM", video: 1, duration: 160, transcribed: false, lines: [] });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    expect(
      await screen.findByText(/Not heard on this PC yet: the transcription engine or its model is not installed/),
    ).toBeInTheDocument();
    expect(player().getAttribute("src")).toMatch(/docs\/FILM\/video\/1\/light\.mp4/);
  });

  it("the reference transcript is kept, and the models are measured against it", async () => {
    serve();
    api.routes["media.reference"] = (i) => ({
      lines: i.text === undefined ? [] : [{ at: 2, text: "Bonjour, on ouvre le poste." }],
    });
    api.routes["media.measure"] = () => ({
      doc: "FILM",
      video: 1,
      at: "2026-11-10T10:00:00.000Z",
      from: 0,
      to: 22,
      words: 5,
      rows: [
        {
          model: "turbo",
          label: "Whisper large-v3 turbo (8-bit)",
          device: "gpu",
          jargon: 0.5,
          terms: 2,
          wer: 0.064,
          timing: 0.4,
          speed: 39,
        },
      ],
    });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    fireEvent.click(await screen.findByRole("button", { name: "Reference…" }));
    const dialog = await screen.findByRole("dialog", { name: "Reference transcript" });
    const field = within(dialog).getByRole("textbox", { name: "Reference transcript" });
    await waitFor(() => expect(field).not.toBeDisabled());
    fireEvent.change(field, { target: { value: "[00:02] Bonjour, on ouvre le poste." } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save and measure the models" }));
    await waitFor(() => expect(named("media.measure")[0]?.input).toEqual({ doc: "FILM", video: 1 }));
    expect(named("media.reference").at(-1)?.input).toEqual({
      doc: "FILM",
      video: 1,
      text: "[00:02] Bonjour, on ouvre le poste.",
    });
    expect(await within(dialog).findByText("50 % of 2")).toBeInTheDocument();
    expect(within(dialog).getByText("6.4 %")).toBeInTheDocument();
    expect(within(dialog).getByText("× 39 · card")).toBeInTheDocument();
  });
});
