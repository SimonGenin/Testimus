// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Video, type VideoHandle, type VideoProps } from "../../../../src/ui/components/ui/Video.tsx";

const NAME = "Video manoeuvre.mp4";
const CITED = { from: 80, to: 100 };

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

// ponytail: jsdom plays nothing — play and pause are stood in, and say so as the element would (its events, paused)
beforeEach(() => {
  play = vi.fn(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { value: false, configurable: true });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  pause = vi.fn(function (this: HTMLMediaElement) {
    Object.defineProperty(this, "paused", { value: true, configurable: true });
    this.dispatchEvent(new Event("pause"));
  });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play as () => Promise<void>);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause as () => void);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const video = (name = NAME) => screen.getByLabelText(name) as HTMLVideoElement;
const player = (name = NAME) => screen.getByRole("group", { name });
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const loopButton = () => button(/^Loop/);
const timeline = () => screen.getByRole("group", { name: "Timeline" });
const position = () => within(timeline()).getByRole("slider", { name: "Position" });
const bound = (which: "Start" | "End") => screen.getByRole("slider", { name: `${which} of the cited range` });
const part = (name: string) => timeline().querySelector<HTMLElement>(`[data-part="${name}"]`);
const at = (seconds: number) => {
  video().currentTime = seconds;
  fireEvent.timeUpdate(video());
};
// ponytail: jsdom lays nothing out — the timeline is given a width of 200, one px per second of a 200 s video
const laidOut = () => vi.spyOn(timeline(), "getBoundingClientRect").mockReturnValue({ left: 0, width: 200 } as DOMRect);

function mount(props: Partial<VideoProps> = {}) {
  const ref = createRef<VideoHandle>();
  const onTime = vi.fn();
  const view = render(<Video ref={ref} src="/v.mp4" label={NAME} onTime={onTime} duration={200} {...props} />);
  const again = (next: Partial<VideoProps>) =>
    view.rerender(<Video ref={ref} src="/v.mp4" label={NAME} onTime={onTime} duration={200} {...props} {...next} />);
  return { handle: () => ref.current as VideoHandle, onTime, again };
}

describe("Video", () => {
  it("is a named group around its video, with its own controls and none of the browser's", () => {
    render(<Video src="/files/docs/V/files/manoeuvre.mp4" label={NAME} poster="/files/p.jpg" />);
    const v = video();
    expect(v.tagName).toBe("VIDEO");
    expect(v).not.toHaveAttribute("controls");
    expect(v).toHaveAttribute("preload", "metadata");
    expect(v).toHaveAttribute("poster", "/files/p.jpg");
    expect(v.getAttribute("src")).toBe("/files/docs/V/files/manoeuvre.mp4");
    expect(player()).toContainElement(v);
    expect(player()).toHaveAttribute("tabindex", "0");
    for (const name of ["Play", "− 5 s", "+ 5 s", "× 1", /^Loop/, "Full screen"])
      expect(within(player()).getByRole("button", { name })).toBeEnabled();
    expect(loopButton()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Back to the excerpt" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Subtitles/ })).toBeNull();
    expect(screen.queryByRole("slider", { name: /cited range/ })).toBeNull();
  });

  it("opens at a moment through the media fragment", () => {
    render(<Video src="/files/v.mp4?project=P" label={NAME} start={80.6} />);
    expect(video().getAttribute("src")).toBe("/files/v.mp4?project=P#t=80");
  });

  it("goes to a moment when asked and tells where it is as it plays", () => {
    const onTime = vi.fn();
    const ref = createRef<VideoHandle>();
    render(<Video ref={ref} src="/v.mp4" label={NAME} onTime={onTime} />);
    act(() => ref.current?.seek(32));
    expect(video().currentTime).toBe(32);
    expect(onTime).toHaveBeenLastCalledWith(32);
    act(() => ref.current?.seek(-5));
    expect(video().currentTime).toBe(0);
    fireEvent.timeUpdate(video());
    expect(onTime).toHaveBeenCalledTimes(3);
  });

  it("plays and pauses from its button, the picture, Space, K and from outside", () => {
    const { handle } = mount();
    fireEvent.click(button("Play"));
    expect(play).toHaveBeenCalledTimes(1);
    fireEvent.click(button("Pause"));
    expect(pause).toHaveBeenCalledTimes(1);
    fireEvent.click(video());
    expect(button("Pause")).toBeInTheDocument();
    fireEvent.keyDown(player(), { key: " " });
    expect(button("Play")).toBeInTheDocument();
    fireEvent.keyDown(player(), { key: "K" });
    expect(button("Pause")).toBeInTheDocument();
    act(() => handle().pause());
    expect(button("Play")).toBeInTheDocument();
    act(() => handle().play());
    expect(button("Pause")).toBeInTheDocument();
  });

  it("leaves Space to the button that has the focus, and other keys with Ctrl to the page", () => {
    mount();
    fireEvent.keyDown(loopButton(), { key: " " });
    fireEvent.keyDown(player(), { key: "k", ctrlKey: true });
    expect(play).not.toHaveBeenCalled();
  });

  it("draws its timeline from the length given, then from the file's own", () => {
    mount();
    expect(position()).toHaveAttribute("aria-valuemin", "0");
    expect(position()).toHaveAttribute("aria-valuemax", "200");
    expect(screen.getByText("00:00 / 03:20")).toBeInTheDocument();
    Object.defineProperty(video(), "duration", { value: 260, configurable: true });
    fireEvent.loadedMetadata(video());
    expect(position()).toHaveAttribute("aria-valuemax", "260");
    expect(screen.getByText("00:00 / 04:20")).toBeInTheDocument();
  });

  it("the timeline is a slider: it says where the playhead is, a click or a drag goes there, Home and End too", () => {
    mount();
    laidOut();
    at(76);
    expect(position()).toHaveAttribute("aria-valuenow", "76");
    expect(position()).toHaveAttribute("aria-valuetext", "01:16 of 03:20");
    expect(part("playhead")?.style.left).toBe("38%");
    expect(part("played")?.style.width).toBe("38%");
    fireEvent.pointerDown(position(), { clientX: 50 });
    expect(video().currentTime).toBe(50);
    fireEvent.pointerMove(position(), { clientX: 120 });
    expect(video().currentTime).toBe(120);
    fireEvent.pointerUp(position());
    fireEvent.pointerMove(position(), { clientX: 10 });
    expect(video().currentTime).toBe(120);
    fireEvent.keyDown(position(), { key: "End" });
    expect(video().currentTime).toBe(200);
    fireEvent.keyDown(position(), { key: "Home" });
    expect(video().currentTime).toBe(0);
  });

  it("moves 5 s with its buttons and the arrows, one frame with , and . when paused, never before the start", () => {
    const { handle, onTime } = mount();
    act(() => handle().seek(32));
    fireEvent.click(button("+ 5 s"));
    expect(video().currentTime).toBe(37);
    expect(onTime).toHaveBeenLastCalledWith(37);
    fireEvent.click(button("− 5 s"));
    expect(video().currentTime).toBe(32);
    fireEvent.keyDown(player(), { key: "ArrowRight" });
    expect(video().currentTime).toBe(37);
    fireEvent.keyDown(position(), { key: "ArrowLeft" });
    expect(video().currentTime).toBe(32);
    fireEvent.keyDown(player(), { key: "." });
    expect(video().currentTime).toBeCloseTo(32.04);
    fireEvent.keyDown(player(), { key: "," });
    expect(video().currentTime).toBeCloseTo(32);
    fireEvent.click(button("Play"));
    fireEvent.keyDown(player(), { key: "." });
    expect(video().currentTime).toBeCloseTo(32);
    act(() => handle().seek(2));
    fireEvent.keyDown(player(), { key: "ArrowLeft" });
    expect(video().currentTime).toBe(0);
    act(() => handle().seek(500));
    expect(video().currentTime).toBe(200);
  });

  it("cycles its speed × 1 → × 1.5 → × 0.5 → × 1", () => {
    mount();
    fireEvent.click(button("× 1"));
    expect(video().playbackRate).toBe(1.5);
    fireEvent.click(button("× 1.5"));
    expect(video().playbackRate).toBe(0.5);
    fireEvent.click(button("× 0.5"));
    expect(video().playbackRate).toBe(1);
    expect(button("× 1")).toBeInTheDocument();
  });

  it("a cited range is drawn with its margins and opens, without playing, where its loop starts", () => {
    mount({ range: CITED });
    expect(video().getAttribute("src")).toBe("/v.mp4#t=76");
    expect(play).not.toHaveBeenCalled();
    expect(part("cited")?.style.left).toBe("40%");
    expect(part("cited")?.style.width).toBe("10%");
    expect(part("margins")?.style.left).toBe("38%");
    expect(part("margins")?.style.width).toBe("14%");
    expect(part("played")).toBeNull();
    expect(screen.getByText("01:16 / 03:20")).toBeInTheDocument();
    expect(screen.getByText("cited 01:20 → 01:40")).toBeInTheDocument();
    expect(screen.getByText("margin 4 s")).toBeInTheDocument();
    expect(screen.getByText("Loop · 01:16 – 01:44")).toBeInTheDocument();
    expect(loopButton()).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "Back to the excerpt" })).toBeNull();
  });

  it("loops on the range and its margins: at the end of the margin it goes back to its start", () => {
    const { onTime } = mount({ range: CITED });
    at(103.9);
    expect(video().currentTime).toBe(103.9);
    at(104.1);
    expect(video().currentTime).toBe(76);
    expect(onTime).toHaveBeenLastCalledWith(76);
    expect(loopButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("the margin is 4 s unless given, and shorter at the video's two ends", () => {
    const { again } = mount({ range: CITED, margin: 10 });
    expect(screen.getByText("margin 10 s")).toBeInTheDocument();
    expect(screen.getByText("Loop · 01:10 – 01:50")).toBeInTheDocument();
    again({ range: { from: 2, to: 198 }, margin: 10 });
    expect(screen.getByText("Loop · 00:00 – 03:20")).toBeInTheDocument();
  });

  it("a moment asked outside the loop leaves it, the range stays drawn, and Back to the excerpt returns to it", () => {
    const { handle } = mount({ range: CITED });
    act(() => handle().seek(90));
    expect(loopButton()).toHaveAttribute("aria-pressed", "true");
    act(() => handle().seek(150));
    expect(loopButton()).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/^Loop · /)).toBeNull();
    expect(part("cited")?.style.left).toBe("40%");
    at(151);
    expect(video().currentTime).toBe(151);
    fireEvent.click(button("Back to the excerpt"));
    expect(video().currentTime).toBe(76);
    expect(loopButton()).toHaveAttribute("aria-pressed", "true");
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Back to the excerpt" })).toBeNull();
  });

  it("a click on the timeline inside the loop keeps it, outside leaves it", () => {
    mount({ range: CITED });
    laidOut();
    fireEvent.pointerDown(position(), { clientX: 95 });
    expect(video().currentTime).toBe(95);
    expect(loopButton()).toHaveAttribute("aria-pressed", "true");
    fireEvent.pointerDown(position(), { clientX: 20 });
    expect(video().currentTime).toBe(20);
    expect(loopButton()).toHaveAttribute("aria-pressed", "false");
    expect(button("Back to the excerpt")).toBeInTheDocument();
  });

  it("Loop and L turn the loop off and on; turned on past the range, playing goes back to it", () => {
    mount({ range: CITED });
    fireEvent.click(loopButton());
    expect(loopButton()).toHaveAttribute("aria-pressed", "false");
    expect(button("Back to the excerpt")).toBeInTheDocument();
    at(120);
    expect(video().currentTime).toBe(120);
    fireEvent.keyDown(player(), { key: "l" });
    expect(loopButton()).toHaveAttribute("aria-pressed", "true");
    expect(button("Back to the excerpt")).toBeInTheDocument();
    at(120.2);
    expect(video().currentTime).toBe(76);
    expect(screen.queryByRole("button", { name: "Back to the excerpt" })).toBeNull();
  });

  it("where the browser tells each frame shown, the loop returns on the frame, armed again while it plays", () => {
    const frames: (() => void)[] = [];
    const proto = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
    proto.requestVideoFrameCallback = vi.fn((cb: () => void) => frames.push(cb));
    proto.cancelVideoFrameCallback = vi.fn();
    try {
      mount({ range: CITED });
      expect(proto.requestVideoFrameCallback).not.toHaveBeenCalled();
      fireEvent.click(button("Play"));
      expect(frames).toHaveLength(1);
      video().currentTime = 103.96;
      act(() => frames[0]());
      expect(video().currentTime).toBe(103.96);
      expect(frames).toHaveLength(2);
      video().currentTime = 104;
      act(() => frames[1]());
      expect(video().currentTime).toBe(76);
      expect(screen.getByText("01:16 / 03:20")).toBeInTheDocument();
      expect(frames).toHaveLength(3);
      fireEvent.click(button("Pause"));
      expect(proto.cancelVideoFrameCallback).toHaveBeenCalledWith(3);
    } finally {
      delete proto.requestVideoFrameCallback;
      delete proto.cancelVideoFrameCallback;
    }
  });

  it("without a range, Loop plays the whole video again when it ends", () => {
    mount();
    at(200);
    Object.defineProperty(video(), "ended", { value: true, configurable: true });
    fireEvent.ended(video());
    expect(video().currentTime).toBe(200);
    fireEvent.click(loopButton());
    expect(loopButton()).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText(/^Loop · /)).toBeNull();
    fireEvent.ended(video());
    expect(video().currentTime).toBe(0);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("another range cited restarts the loop at its start; the range a moved bound gave coming back does not", () => {
    const onRange = vi.fn();
    const { again, handle } = mount({ range: CITED, onRange });
    act(() => handle().seek(150));
    again({ range: { from: 20, to: 30 }, onRange });
    expect(video().currentTime).toBe(16);
    expect(loopButton()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("cited 00:20 → 00:30")).toBeInTheDocument();
    expect(video().getAttribute("src")).toBe("/v.mp4#t=76");
    act(() => handle().seek(25));
    fireEvent.keyDown(bound("End"), { key: "ArrowRight" });
    fireEvent.keyUp(bound("End"), { key: "ArrowRight" });
    expect(onRange).toHaveBeenLastCalledWith({ from: 20, to: 31 });
    again({ range: { from: 20, to: 31 }, onRange });
    expect(video().currentTime).toBe(25);
    again({ range: undefined, onRange });
    expect(part("cited")).toBeNull();
    expect(loopButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("loop(range) from outside plays another range in a loop — a line to listen to — and the excerpt is one click away", () => {
    const { handle } = mount({ range: CITED });
    act(() => handle().loop({ from: 30, to: 35 }));
    expect(video().currentTime).toBe(26);
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Loop · 00:26 – 00:39")).toBeInTheDocument();
    expect(part("cited")?.style.left).toBe("40%");
    expect(part("margins")?.style.left).toBe("13%");
    at(39.5);
    expect(video().currentTime).toBe(26);
    fireEvent.click(button("Back to the excerpt"));
    expect(video().currentTime).toBe(76);
    expect(screen.getByText("Loop · 01:16 – 01:44")).toBeInTheDocument();
  });

  it("with onRange the two bounds are sliders: the arrows move one a second, told in whole seconds when let go", () => {
    const onRange = vi.fn();
    const { handle } = mount({ range: { from: 80.4, to: 100 }, onRange });
    act(() => handle().seek(90));
    expect(bound("Start")).toHaveAttribute("aria-valuenow", "80");
    expect(bound("Start")).toHaveAttribute("aria-valuetext", "01:20");
    expect(bound("Start")).toHaveAttribute("aria-valuemax", "99");
    expect(bound("End")).toHaveAttribute("aria-valuenow", "100");
    expect(bound("End")).toHaveAttribute("aria-valuemin", "81");
    expect(bound("End")).toHaveAttribute("aria-valuemax", "200");
    fireEvent.keyDown(bound("Start"), { key: "ArrowRight" });
    fireEvent.keyDown(bound("Start"), { key: "ArrowRight" });
    expect(onRange).not.toHaveBeenCalled();
    expect(screen.getByText("cited 01:22 → 01:40")).toBeInTheDocument();
    fireEvent.keyUp(bound("Start"), { key: "ArrowRight" });
    expect(onRange).toHaveBeenCalledTimes(1);
    expect(onRange).toHaveBeenLastCalledWith({ from: 82, to: 100 });
    fireEvent.keyDown(bound("End"), { key: "ArrowLeft" });
    fireEvent.keyUp(bound("End"), { key: "ArrowLeft" });
    expect(onRange).toHaveBeenLastCalledWith({ from: 82, to: 99 });
    expect(screen.getByText("Loop · 01:18 – 01:43")).toBeInTheDocument();
    expect(video().currentTime).toBe(90);
    fireEvent.keyUp(bound("End"), { key: "Tab" });
    fireEvent.keyUp(bound("End"), { key: "ArrowLeft" });
    expect(onRange).toHaveBeenCalledTimes(2);
  });

  it("a bound never crosses the other nor leaves the video: from stays under to by a second", () => {
    const onRange = vi.fn();
    mount({ range: { from: 198, to: 199 }, onRange });
    fireEvent.keyDown(bound("Start"), { key: "ArrowRight" });
    fireEvent.keyUp(bound("Start"), { key: "ArrowRight" });
    fireEvent.keyDown(bound("End"), { key: "ArrowLeft" });
    fireEvent.keyUp(bound("End"), { key: "ArrowLeft" });
    expect(onRange).not.toHaveBeenCalled();
    fireEvent.keyDown(bound("End"), { key: "ArrowRight" });
    fireEvent.keyDown(bound("End"), { key: "ArrowRight" });
    fireEvent.keyUp(bound("End"), { key: "ArrowRight" });
    expect(onRange).toHaveBeenCalledTimes(1);
    expect(onRange).toHaveBeenLastCalledWith({ from: 198, to: 200 });
  });

  it("a bound is dragged along the timeline, to whole seconds, and told once when the pointer lets go", () => {
    const onRange = vi.fn();
    mount({ range: CITED, onRange });
    laidOut();
    fireEvent.pointerMove(bound("End"), { clientX: 150 });
    fireEvent.pointerDown(bound("End"), { clientX: 100 });
    fireEvent.pointerMove(bound("End"), { clientX: 110.4 });
    expect(bound("End")).toHaveAttribute("aria-valuenow", "110");
    fireEvent.pointerMove(bound("End"), { clientX: 40 });
    expect(bound("End")).toHaveAttribute("aria-valuenow", "81");
    fireEvent.pointerMove(bound("End"), { clientX: 123.6 });
    expect(onRange).not.toHaveBeenCalled();
    fireEvent.pointerUp(bound("End"));
    expect(onRange).toHaveBeenCalledTimes(1);
    expect(onRange).toHaveBeenLastCalledWith({ from: 80, to: 124 });
    expect(bound("End").style.left).toBe("62%");
    fireEvent.pointerDown(bound("Start"), { clientX: 80 });
    fireEvent.pointerUp(bound("Start"));
    expect(onRange).toHaveBeenCalledTimes(1);
  });

  it("marks its chapters and its key frames on the timeline, each with its words", () => {
    mount({
      chapters: [
        { at: 0, title: "Ouverture du poste" },
        { at: 80, title: "Menu contextuel" },
      ],
      marks: [{ at: 100, label: "frame:01:40 La fenêtre Propriétés" }],
    });
    expect(within(timeline()).getByTitle("Ouverture du poste").style.left).toBe("0%");
    expect(within(timeline()).getByTitle("Menu contextuel").style.left).toBe("40%");
    expect(within(timeline()).getByTitle("frame:01:40 La fenêtre Propriétés").style.left).toBe("50%");
  });

  it("Subtitles shows the track given, and with two goes off → first → second → off", () => {
    const subtitles = [
      { src: "/files/said.vtt", label: "original", lang: "de" },
      { src: "/files/translated.vtt", label: "translated", lang: "fr" },
    ];
    const { again } = mount({ subtitles: [subtitles[0]] });
    const tracks = [{ mode: "disabled" }, { mode: "disabled" }];
    Object.defineProperty(video(), "textTracks", { value: tracks, configurable: true });
    const [first] = [...video().querySelectorAll("track")];
    expect(first).toHaveAttribute("kind", "subtitles");
    expect(first).toHaveAttribute("src", "/files/said.vtt");
    expect(first).toHaveAttribute("label", "original");
    expect(first).toHaveAttribute("srclang", "de");
    expect(button("Subtitles")).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button("Subtitles"));
    expect(button("Subtitles")).toHaveAttribute("aria-pressed", "true");
    expect(tracks.map((t) => t.mode)).toEqual(["showing", "disabled"]);
    fireEvent.click(button("Subtitles"));
    expect(button("Subtitles")).toHaveAttribute("aria-pressed", "false");
    expect(tracks.map((t) => t.mode)).toEqual(["disabled", "disabled"]);
    again({ subtitles });
    expect(video().querySelectorAll("track")).toHaveLength(2);
    fireEvent.click(button("Subtitles"));
    expect(button("Subtitles · original")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(button("Subtitles · original"));
    expect(button("Subtitles · translated")).toHaveAttribute("aria-pressed", "true");
    expect(tracks.map((t) => t.mode)).toEqual(["disabled", "showing"]);
    fireEvent.click(button("Subtitles · translated"));
    expect(button("Subtitles")).toHaveAttribute("aria-pressed", "false");
    expect(tracks.map((t) => t.mode)).toEqual(["disabled", "disabled"]);
  });

  it("says once per file that the browser cannot play it, and nothing for another error", () => {
    const onUnplayable = vi.fn();
    const { again } = mount({ onUnplayable });
    Object.defineProperty(video(), "error", { value: { code: 2 }, configurable: true });
    fireEvent.error(video());
    expect(onUnplayable).not.toHaveBeenCalled();
    Object.defineProperty(video(), "error", { value: { code: 4 }, configurable: true });
    fireEvent.error(video());
    fireEvent.error(video());
    expect(onUnplayable).toHaveBeenCalledTimes(1);
    again({ onUnplayable, src: "/other.avi" });
    expect(video().getAttribute("src")).toBe("/other.avi");
    fireEvent.error(video());
    expect(onUnplayable).toHaveBeenCalledTimes(2);
  });

  it("Full screen asks it for the frame around the picture, and a refusal is not an error", () => {
    const asked = vi.fn(() => Promise.reject(new Error("not allowed")));
    mount();
    const frame = video().parentElement as HTMLElement;
    frame.requestFullscreen = asked;
    fireEvent.click(button("Full screen"));
    expect(asked).toHaveBeenCalledTimes(1);
    expect(player()).toContainElement(frame);
  });

  it('size="sm" keeps every control, Loop, Back to the excerpt and Subtitles as icons alone', () => {
    const subtitles = [{ src: "/files/said.vtt", label: "original", lang: "fr" }];
    const { handle, again } = mount({ range: CITED, subtitles });
    act(() => handle().seek(150));
    for (const name of [/^Loop/, "Back to the excerpt", "Subtitles"]) {
      expect(button(name)).not.toHaveAttribute("aria-label");
      expect(button(name)).toHaveTextContent(name);
    }
    again({ size: "sm" });
    for (const name of ["Loop", "Back to the excerpt", "Subtitles"]) {
      expect(button(name)).toHaveAttribute("aria-label", name);
      expect(button(name).textContent).toBe("");
    }
    for (const name of ["Play", "− 5 s", "+ 5 s", "× 1", "Full screen"]) expect(button(name)).toBeEnabled();
    fireEvent.click(button("Back to the excerpt"));
    expect(video().currentTime).toBe(76);
    expect(button("Loop")).toHaveAttribute("aria-pressed", "true");
  });
});
