// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaFile } from "../../../../src/core/types.ts";
import type { AppState } from "../../../../src/ui/lib/app.ts";
import { setProject } from "../../../../src/ui/lib/data/client.ts";
import { typeLabel } from "../../../../src/ui/lib/media.ts";
import { addMedia } from "../../../../src/ui/lib/media-uploads.ts";
import { DocumentsScreen } from "../../../../src/ui/screens/documents/DocumentsScreen.tsx";
import { choose } from "../../helpers/select.ts";
import { api, app, FakeEventSource, fakeFetch, named, noDesktop } from "../../helpers/ui-desktop.tsx";
import { clearToasts } from "../../helpers/ui-screens.tsx";
import { at, type DocRef, doc, emit, mountDocs } from "./helpers.tsx";

const film = (over: Partial<MediaFile> = {}): MediaFile => ({
  n: 1,
  name: "manoeuvre.mp4",
  file: "files/manoeuvre.mp4",
  kind: "video",
  sha256: "x",
  state: "new",
  ...over,
});

const added = (over: Partial<DocRef> = {}, files: MediaFile[] = [film()]): DocRef =>
  doc("FILM", {
    title: "Manœuvre au PCC",
    kind: "other",
    type: "video",
    observed: true,
    converted: undefined,
    indexed: "missing",
    source: { type: "video", name: files[0]?.name ?? "", file: "files", sha256: "", files },
    ...over,
  });

const estimate = (over: Record<string, unknown> = {}) => ({
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
  disk: { needMB: 12, freeMB: 90_000, usedMB: 300, over: false },
  ...over,
});

let served: DocRef;

function serve(d: DocRef, cost: Record<string, unknown> = {}) {
  served = d;
  api.routes["docs.list"] = () => [served];
  api.routes["docs.show"] = () => ({
    doc: served,
    type: served.type,
    observed: served.observed,
    context: "",
    contextMtime: null,
    contexts: [],
    toc: [],
    figures: [],
    md: "",
  });
  api.routes["docs.set"] = (i) => {
    served = { ...served, ...(i.reference !== undefined ? { reference: i.reference as boolean } : {}) };
    return { ...served, contextMtime: null };
  };
  api.routes["media.show"] = () => ({ doc: "FILM", type: served.type, observed: true, images: [], videos: [] });
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
  api.routes["media.estimate"] = () => estimate(cost);
  api.routes["media.set"] = () => film();
}

const withProject = (video: Record<string, unknown>): Partial<AppState> => {
  const base = app().info as unknown as { project: Record<string, unknown> };
  return {
    route: { screen: "documents", arg: "FILM" },
    info: { ...base, project: { ...base.project, video } } as unknown as AppState["info"],
  };
};

const pane = () => screen.findByRole("region", { name: "Convert and index" });

beforeEach(() => {
  fakeFetch();
  FakeEventSource.last = null;
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  cleanup();
  clearToasts();
  noDesktop();
  setProject(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a video before its first conversion", () => {
  it("what is heard of it is chosen there — languages, sound track, a part — kept on the video, and the estimate follows", async () => {
    serve(added());
    mountDocs(<DocumentsScreen />, withProject({ spoken: ["fr"] }));
    const v = await within(await pane()).findByRole("region", { name: "manoeuvre.mp4" });
    expect(within(v).queryByRole("textbox", { name: "From" })).toBeNull();
    fireEvent.click(within(v).getByRole("button", { name: "Languages, track and part heard" }));
    const languages = within(v).getByRole("combobox", { name: "Languages spoken in this video" });
    await waitFor(() => expect(languages).toHaveAttribute("placeholder", "The project's: French"));
    fireEvent.focus(languages);
    fireEvent.click(
      within(await screen.findByRole("listbox", { name: "Languages spoken in this video" })).getByRole("option", {
        name: "German",
      }),
    );
    await waitFor(() =>
      expect(named("media.set")[0]?.input).toEqual({
        doc: "FILM",
        video: 1,
        spoken: ["de"],
        allTracks: true,
        whole: true,
      }),
    );
    choose(await within(v).findByRole("combobox", { name: "Sound" }), "Track 2");
    await waitFor(() =>
      expect(named("media.set")[1]?.input).toEqual({ doc: "FILM", video: 1, spoken: ["de"], track: 1, whole: true }),
    );

    const read = named("media.estimate").length;
    api.routes["media.estimate"] = () => estimate({ speechSeconds: 600 });
    const from = within(v).getByRole("textbox", { name: "From" });
    fireEvent.change(from, { target: { value: "00:30" } });
    expect(named("media.set")).toHaveLength(2);
    fireEvent.blur(from);
    await waitFor(() =>
      expect(named("media.set")[2]?.input).toEqual({
        doc: "FILM",
        video: 1,
        spoken: ["de"],
        track: 1,
        from: "00:30",
        to: "160",
      }),
    );
    await waitFor(() => expect(named("media.estimate").length).toBeGreaterThan(read));
    expect(await within(v).findByText(/about 10 min to hear it on the graphics card/)).toBeInTheDocument();
    fireEvent.blur(from);
    const to = within(v).getByRole("textbox", { name: "To" });
    fireEvent.change(to, { target: { value: "01:00" } });
    fireEvent.keyDown(to, { key: "Tab" });
    fireEvent.blur(to);
    await waitFor(() => expect(named("media.set")[3]?.input).toMatchObject({ from: "00:30", to: "01:00" }));
    expect(named("media.set")).toHaveLength(4);
  });

  it("a choice the core refuses is said, and the field keeps what was typed", async () => {
    serve(added());
    api.routes["media.set"] = () => {
      throw Object.assign(new Error("The part to transcribe is not a moment."), { code: "bad" });
    };
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    const v = await within(await pane()).findByRole("region", { name: "manoeuvre.mp4" });
    fireEvent.click(within(v).getByRole("button", { name: "Languages, track and part heard" }));
    expect(within(v).getByRole("combobox", { name: "Languages spoken in this video" })).toHaveAttribute(
      "placeholder",
      "The project's languages",
    );
    const from = within(v).getByRole("textbox", { name: "From" });
    fireEvent.change(from, { target: { value: "soon" } });
    fireEvent.blur(from);
    expect(await screen.findByText("The choice was not kept")).toBeInTheDocument();
    expect(from).toHaveValue("soon");
  });

  it("the choices a video already carries are shown, and a video with one sound track offers no choice of track", async () => {
    serve(added({}, [film({ spoken: ["de"], range: { from: 300, to: 1200 } })]), { tracks: 1 });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    const v = await within(await pane()).findByRole("region", { name: "manoeuvre.mp4" });
    expect(await within(v).findByText("German")).toBeInTheDocument();
    expect(within(v).getByRole("textbox", { name: "From" })).toHaveValue("05:00");
    expect(within(v).getByRole("textbox", { name: "To" })).toHaveValue("20:00");
    await within(v).findByText(/about a minute to hear it/);
    expect(within(v).queryByRole("combobox", { name: "Sound" })).toBeNull();
    expect(named("media.set")).toHaveLength(0);
  });

  it("says what goes to Claude and what it costs, and « Prepare and read » lets Claude read the pictures", async () => {
    serve(added());
    api.routes["docs.convert"] = () => ({ id: "FILM" });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    const p = await pane();
    expect(
      within(p).getByText(
        "Its pictures and what is said go to Claude in its runs, like the documents; the sound never does.",
      ),
    ).toBeInTheDocument();
    expect(await within(p).findByText("About 4 runs, 8 pictures")).toBeInTheDocument();
    expect(within(p).getByRole("checkbox", { name: "Claude reads the pictures and surveys the videos" })).toBeChecked();
    fireEvent.click(within(p).getByRole("button", { name: "Prepare and read" }));
    await waitFor(() => expect(named("docs.convert")[0]?.input).toMatchObject({ id: "FILM", describeFigures: true }));
  });

  it("the cap the team set for the videos is said with what they take, and a warning when it is passed", async () => {
    serve(added(), { disk: { needMB: 12, freeMB: 90_000, usedMB: 1536, capMB: 2048, over: false } });
    const first = mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    expect(await screen.findByText("1.5 of 2 GB used by the project's videos")).toBeInTheDocument();
    expect(screen.queryByText("The project's videos pass the room they may take")).toBeNull();
    first.unmount();
    serve(added(), { disk: { needMB: 12, freeMB: 90_000, usedMB: 2300, capMB: 2048, over: true } });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    const warning = (await screen.findByText("The project's videos pass the room they may take")).closest(
      '[role="alert"]',
    ) as HTMLElement;
    expect(warning).toHaveTextContent(
      "2.2 of 2 GB are used: a video added now is refused. Raise the cap in Settings › Videos, or remove a video.",
    );
  });

  it("without a cap nothing is said of one", async () => {
    serve(added());
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    expect(await screen.findByText(/About 12 MB with what is drawn from it/)).toBeInTheDocument();
    expect(screen.queryByText(/used by the project's videos/)).toBeNull();
  });
});

describe("a recording of sound alone", () => {
  const memo = () =>
    added({ title: "Réunion" }, [film({ name: "reunion.m4a", file: "files/reunion.m4a", duration: 160 })]);

  it("is a document that reads « Sound », and its estimate speaks of no picture", async () => {
    serve(memo(), { framesSeconds: 0, seconds: 5, claude: { runs: 1, images: 0 }, tracks: 1 });
    mountDocs(<DocumentsScreen />, { route: { screen: "documents", arg: "FILM" } });
    const list = await screen.findByRole("region", { name: "Document list" });
    expect(await within(list).findByText("Sound · 02:40")).toBeInTheDocument();
    const p = await pane();
    const v = await within(p).findByRole("region", { name: "reunion.m4a" });
    expect(
      await within(v).findByText("about a minute to hear it on the graphics card · measured here"),
    ).toBeInTheDocument();
    expect(within(v).getByText("About 1 run")).toBeInTheDocument();
    expect(within(v).getByLabelText("What the recording will take")).toBeInTheDocument();
    expect(within(p).queryByText(/pictures$/)).toBeNull();
    expect(within(p).queryByText(/to look through it/)).toBeNull();
    fireEvent.click(within(v).getByRole("button", { name: "Languages, track and part heard" }));
    expect(within(v).getByRole("combobox", { name: "Languages spoken in this recording" })).toBeInTheDocument();
    expect(
      within(p).getByText("What is said goes to Claude in its runs, like the documents; the sound never does."),
    ).toBeInTheDocument();
  });

  it("the words of the list: Sound for a recording, Video for a video", () => {
    const of = (type: DocRef["type"], files: MediaFile[]) => typeLabel({ type, source: added({}, files).source });
    expect(of("video", [film({ name: "memo.MP3", duration: 760 })])).toBe("Sound · 12:40");
    expect(of("video", [film({ name: "memo.flac" })])).toBe("Sound");
    expect(of("video", [film({ duration: 760 })])).toBe("Video · 12:40");
    expect(of("video", [])).toBe("Video");
  });
});

describe("a video the cap refuses", () => {
  const why =
    "The project's videos take 2300 MB of the 2048 MB the project allows them: this one does not fit. Raise the cap in Settings › Videos (testimus project set --video.disk-cap-gb=<n>), or remove a video.";

  it("added as a document: the list says why it was not added", async () => {
    api.routes["docs.list"] = () => [doc("D1")];
    api.routes["docs.show"] = () => ({ doc: doc("D1"), context: "", toc: [], figures: [], md: "" });
    api.routes["docs.addFiles"] = () => ({ jobId: "add-1" });
    api.routes["jobs.show"] = (i) => ({ job: { id: i.id, kind: "x", subject: "", status: "running", startedAt: at } });
    const { container } = mountDocs(<DocumentsScreen />);
    await screen.findByText("Title D1");
    window.testimusDesktop = { pathOf: (f: File) => `C:\\d\\${f.name}` } as never;
    fireEvent.drop(container.querySelector('[data-testid="documents-screen"]') as HTMLElement, {
      dataTransfer: { files: [new File(["x"], "essai.mp4")] },
    });
    delete window.testimusDesktop;
    await waitFor(() => expect(named("docs.addFiles")).toHaveLength(1));
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    emit({
      jobId: "add-1",
      at,
      type: "status",
      job: {
        id: "add-1",
        kind: "docs.add",
        subject: "essai.mp4",
        status: "done",
        startedAt: at,
        endedAt: new Date().toISOString(),
        result: { added: [], rejected: [{ name: "essai.mp4", why, code: "failed" }] },
      },
    });
    expect(await screen.findByText("Adding essai.mp4 stopped")).toBeInTheDocument();
    expect(screen.getByText(/this one does not fit\. Raise the cap in Settings › Videos/)).toBeInTheDocument();
  });

  it("added to an images document: the refusal is said with its sentence", async () => {
    api.routes["media.add"] = () => ({
      doc: "PHOTOS",
      type: "images",
      added: [],
      rejected: [{ name: "essai.mp4", why, code: "disk-cap" }],
      files: [],
      warnings: [],
      citedBy: [],
    });
    mountDocs(<div />);
    const done = vi.fn();
    await act(() => addMedia("PHOTOS", "Recette TCO", [{ name: "essai.mp4", path: "C:\\d\\essai.mp4" }], done));
    expect(named("media.add")[0]?.input).toMatchObject({ doc: "PHOTOS", files: [{ path: "C:\\d\\essai.mp4" }] });
    expect(await screen.findByText("No file was added")).toBeInTheDocument();
    expect(screen.getByText(`essai.mp4: ${why}`)).toBeInTheDocument();
    expect(done).toHaveBeenCalled();
  });
});
