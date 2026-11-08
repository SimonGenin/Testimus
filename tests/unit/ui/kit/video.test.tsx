// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Video, type VideoHandle } from "../../../../src/ui/components/ui/Video.tsx";

afterEach(cleanup);

const player = () => screen.getByLabelText("Video manoeuvre.mp4") as HTMLVideoElement;

describe("Video", () => {
  it("is the browser's player, named, with its controls, loading only the facts first", () => {
    render(<Video src="/files/docs/V/files/manoeuvre.mp4" label="Video manoeuvre.mp4" poster="/files/p.jpg" />);
    const v = player();
    expect(v.tagName).toBe("VIDEO");
    expect(v).toHaveAttribute("controls");
    expect(v).toHaveAttribute("preload", "metadata");
    expect(v).toHaveAttribute("poster", "/files/p.jpg");
    expect(v.getAttribute("src")).toBe("/files/docs/V/files/manoeuvre.mp4");
  });

  it("opens at a moment through the media fragment", () => {
    render(<Video src="/files/v.mp4?project=P" label="Video manoeuvre.mp4" start={80.6} />);
    expect(player().getAttribute("src")).toBe("/files/v.mp4?project=P#t=80");
  });

  it("goes to a moment when asked and tells where it is as it plays", () => {
    const onTime = vi.fn();
    const ref = createRef<VideoHandle>();
    render(<Video ref={ref} src="/v.mp4" label="Video manoeuvre.mp4" onTime={onTime} />);
    ref.current?.seek(32);
    expect(player().currentTime).toBe(32);
    expect(onTime).toHaveBeenLastCalledWith(32);
    ref.current?.seek(-5);
    expect(player().currentTime).toBe(0);
    fireEvent.timeUpdate(player());
    expect(onTime).toHaveBeenCalledTimes(3);
  });
});
