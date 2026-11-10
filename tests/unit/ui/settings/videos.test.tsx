// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Glossary } from "../../../../src/ui/screens/settings/GlossaryCard.tsx";
import { ProjectSection } from "../../../../src/ui/screens/settings/ProjectSection.tsx";
import { calls, Fail, fakeNet, info, inputs, mountSettings, net, reset } from "./helpers.tsx";

type Video = { spoken?: string[]; glossary?: string[] | null; density?: string; translate?: boolean };

let project = info();
let glossary: Glossary;

const terms = (n: number) => Array.from({ length: n }, (_, i) => `T${i + 1}`);

const said = (over: Partial<Glossary> = {}): Glossary => ({
  terms: ["PCC", "S12", "TCO", "Sectionneur"],
  kept: ["PCC", "S12", "TCO", "Sectionneur"],
  auto: true,
  prompt: "Glossaire : PCC, S12, TCO, Sectionneur.",
  tokens: 17,
  budget: 170,
  heard: [],
  languages: [
    { code: "fr", name: "French", quality: "best" },
    { code: "en", name: "English", quality: "best" },
    { code: "de", name: "German", quality: "best" },
    { code: "cy", name: "Welsh", quality: "good" },
  ],
  ...over,
});

beforeEach(() => {
  fakeNet();
  project = info();
  glossary = said();
  net.routes["project.info"] = () => project;
  net.routes["project.set"] = (i) => {
    const { glossary: g, ...rest } = (i.video ?? {}) as Video;
    const before = (project.project as { video?: Video }).video;
    const video: Video = { ...before, ...rest, ...(g ? { glossary: g } : {}) };
    if (g === null) delete video.glossary;
    project = { ...project, project: { ...project.project, video } };
    if (g !== undefined) glossary = said(g ? { auto: false, terms: g, kept: g.slice(0, 3) } : {});
    return project.project;
  };
  net.routes["media.glossary"] = () => glossary;
});

afterEach(reset);

const videos = () => screen.findByRole("region", { name: "Videos" });
const card = () => screen.findByRole("region", { name: /^Glossary of the transcription/ });
const languages = () => screen.getByRole("combobox", { name: "Languages spoken in the videos" });
const sent = () => inputs("project.set").map((i) => i.video);

describe("Settings › Project › Videos", () => {
  it("the languages spoken are chosen among those the engine hears, shown by name, saved as codes", async () => {
    project = info({ video: { spoken: ["en"], density: "detailed" } });
    mountSettings(<ProjectSection />);
    const v = await videos();
    expect(await within(v).findByText("English")).toBeInTheDocument();
    expect(within(v).getByText(/None: every passage in the language detected/)).toBeInTheDocument();
    fireEvent.focus(languages());
    const list = await screen.findByRole("listbox", { name: "Languages spoken in the videos" });
    expect(within(list).queryByRole("option", { name: "English" })).toBeNull();
    fireEvent.click(within(list).getByRole("option", { name: "German" }));
    await waitFor(() => expect(sent()).toEqual([{ spoken: ["en", "de"] }]));
    expect(await within(v).findByText("German")).toBeInTheDocument();
    expect(within(v).getByRole("radio", { name: "Detailed" })).toBeChecked();
    fireEvent.click(within(v).getByRole("button", { name: "Remove English" }));
    await waitFor(() => expect(sent()[1]).toEqual({ spoken: ["de"] }));
    fireEvent.click(within(v).getByRole("button", { name: "Remove German" }));
    await waitFor(() => expect(sent()[2]).toEqual({ spoken: [] }));
  });

  it("the languages heard so far are offered as those to expect, noises apart", async () => {
    glossary = said({
      heard: [
        { language: "en", seconds: 2460 },
        { language: "de", seconds: 180 },
        { language: "cy", seconds: 5 },
      ],
    });
    project = info({ video: { spoken: ["en"] } });
    mountSettings(<ProjectSection />);
    const v = await videos();
    expect(
      await within(v).findByText("Heard so far in this project: English 41 min · German 3 min"),
    ).toBeInTheDocument();
    fireEvent.click(within(v).getByRole("button", { name: "Expect these" }));
    await waitFor(() => expect(sent()).toEqual([{ spoken: ["en", "de"] }]));
    await waitFor(() => expect(within(v).queryByText(/^Heard so far/)).toBeNull());
    expect(within(v).queryByRole("button", { name: "Expect these" })).toBeNull();
  });

  it("nothing is offered while no video was heard, or only noises", async () => {
    glossary = said({ heard: [{ language: "cy", seconds: 5 }] });
    mountSettings(<ProjectSection />);
    const v = await videos();
    await waitFor(() => expect(calls("media.glossary")).toHaveLength(1));
    fireEvent.focus(languages());
    await screen.findByRole("option", { name: "Welsh" });
    expect(within(v).queryByText(/^Heard so far/)).toBeNull();
  });

  it("the translation is on until turned off; a refused change is put back and said", async () => {
    mountSettings(<ProjectSection />);
    const v = await videos();
    const translate = within(v).getByRole("switch", { name: "Translate what is said in another language" });
    expect(translate).toBeChecked();
    expect(within(v).getByText(/the line as it was said stays the text a test may quote/)).toBeInTheDocument();
    fireEvent.click(translate);
    await waitFor(() => expect(sent()).toEqual([{ translate: false }]));
    await waitFor(() => expect(translate).not.toBeChecked());
    net.routes["project.set"] = () => {
      throw new Fail("project.json is read-only.");
    };
    fireEvent.click(translate);
    expect(await screen.findByText("Could not save the videos' settings")).toBeInTheDocument();
    await waitFor(() => expect(translate).not.toBeChecked());
  });

  it("the key frames are Normal until chosen otherwise", async () => {
    mountSettings(<ProjectSection />);
    const v = await videos();
    const density = within(v).getByRole("radiogroup", { name: "Key frames" });
    expect(within(density).getByRole("radio", { name: "Normal" })).toBeChecked();
    expect(within(v).getByText(/About 40 frames for half an hour/)).toBeInTheDocument();
    fireEvent.click(within(density).getByRole("radio", { name: "Sober" }));
    await waitFor(() => expect(sent()).toEqual([{ density: "sober" }]));
    await waitFor(() => expect(within(density).getByRole("radio", { name: "Sober" })).toBeChecked());
  });

  it("says these hold for the videos heard from now on", async () => {
    mountSettings(<ProjectSection />);
    await videos();
    expect(
      screen.getByText(/a video already heard is heard again from Documents › Video › « Hear again… »/),
    ).toBeInTheDocument();
  });
});

describe("Settings › Project › Videos: the glossary of the transcription", () => {
  it("shows where the terms come from, those kept, those left out, the size and what the engine is given", async () => {
    const all = terms(54);
    glossary = said({ terms: all, kept: all.slice(0, 45), tokens: 157, budget: 170, prompt: "Glossary: T1, T2." });
    mountSettings(<ProjectSection />);
    const c = await card();
    expect(await within(c).findByText("From the documents")).toBeInTheDocument();
    const kept = within(c).getByRole("list", { name: "Terms given to the engine" });
    expect(within(kept).getAllByRole("listitem")).toHaveLength(41);
    expect(within(kept).getByText("T40")).toBeInTheDocument();
    expect(within(kept).queryByText("T41")).toBeNull();
    expect(within(kept).getByText("+ 5 more")).toBeInTheDocument();
    expect(within(c).getByText("9 left out: the engine reads 60 to 80 terms at most")).toBeInTheDocument();
    expect(within(c).getByRole("progressbar", { name: "Size of the glossary" })).toHaveAttribute("aria-valuenow", "92");
    expect(within(c).getByText("157 of 170 tokens")).toBeInTheDocument();
    expect(within(c).queryByText("Glossary: T1, T2.")).toBeNull();
    fireEvent.click(within(c).getByRole("button", { name: "What the engine is given" }));
    expect(within(c).getByText("Glossary: T1, T2.")).toBeInTheDocument();
  });

  it("Edit turns the terms into a list to write, saved in its order; the glossary is then the team's and read again", async () => {
    mountSettings(<ProjectSection />);
    const c = await card();
    fireEvent.click(await within(c).findByRole("button", { name: "Edit" }));
    expect(within(c).queryByRole("button", { name: "Back to the documents' terms" })).toBeNull();
    const box = within(c).getByRole("textbox", { name: "Terms of the glossary" });
    fireEvent.click(within(c).getByRole("button", { name: "Remove TCO" }));
    fireEvent.change(box, { target: { value: "PR2" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(calls("project.set")).toHaveLength(0);
    const before = calls("media.glossary").length;
    fireEvent.click(within(c).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sent()).toEqual([{ glossary: ["PCC", "S12", "Sectionneur", "PR2"] }]));
    expect(await within(c).findByText("Written by the team")).toBeInTheDocument();
    expect(calls("media.glossary").length).toBeGreaterThan(before);
    expect(within(c).queryByRole("textbox", { name: "Terms of the glossary" })).toBeNull();
    expect(within(c).getByText("1 left out: the engine reads 60 to 80 terms at most")).toBeInTheDocument();
  });

  it("a glossary the team wrote goes back to the documents' terms; Cancel changes nothing", async () => {
    glossary = said({ auto: false, terms: ["PR2"], kept: ["PR2"] });
    project = info({ video: { glossary: ["PR2"], density: "sober" } });
    mountSettings(<ProjectSection />);
    const c = await card();
    expect(await within(c).findByText("Written by the team")).toBeInTheDocument();
    fireEvent.click(within(c).getByRole("button", { name: "Edit" }));
    fireEvent.click(within(c).getByRole("button", { name: "Remove PR2" }));
    fireEvent.click(within(c).getByRole("button", { name: "Cancel" }));
    expect(within(c).getByText("PR2")).toBeInTheDocument();
    expect(calls("project.set")).toHaveLength(0);
    fireEvent.click(within(c).getByRole("button", { name: "Edit" }));
    fireEvent.click(within(c).getByRole("button", { name: "Back to the documents' terms" }));
    await waitFor(() => expect(sent()).toEqual([{ glossary: null }]));
    expect(await within(c).findByText("From the documents")).toBeInTheDocument();
    expect(within(c).getByText("Sectionneur")).toBeInTheDocument();
    expect(within(await videos()).getByRole("radio", { name: "Sober" })).toBeChecked();
  });

  it("a save refused keeps what was written and says so", async () => {
    net.routes["project.set"] = () => {
      throw new Fail("project.json is read-only.");
    };
    mountSettings(<ProjectSection />);
    const c = await card();
    fireEvent.click(await within(c).findByRole("button", { name: "Edit" }));
    fireEvent.click(within(c).getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Could not save the glossary of the transcription")).toBeInTheDocument();
    expect(within(c).getByRole("textbox", { name: "Terms of the glossary" })).toBeInTheDocument();
  });

  it("without a term, or when it cannot be read, the card says so", async () => {
    glossary = said({ terms: [], kept: [], prompt: "", tokens: 0 });
    const r = mountSettings(<ProjectSection />);
    const c = await card();
    expect(await within(c).findByText(/^No term yet: the documents gave none\./)).toBeInTheDocument();
    fireEvent.click(within(c).getByRole("button", { name: "What the engine is given" }));
    expect(within(c).getByText("Nothing: the glossary has no term.")).toBeInTheDocument();
    r.unmount();
    net.routes["media.glossary"] = () => {
      throw new Fail("The index is being rebuilt.");
    };
    mountSettings(<ProjectSection />);
    expect(await screen.findByText("The glossary could not be read: The index is being rebuilt.")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Translate what is said in another language" })).toBeInTheDocument();
  });
});
