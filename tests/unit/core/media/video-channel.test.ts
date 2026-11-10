import { existsSync, mkdirSync, mkdtempSync, readdirSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { keepOnChannel, VAD_MODEL, WHISPER_ASSETS } from "../../../../src/core/lib/whisper.ts";
import { llamaIo } from "../../../../src/core/rag/runtimes/llamacpp.ts";

const realDownload = llamaIo.download;
afterEach(() => {
  llamaIo.download = realDownload;
});

describe("a publish keeps the engine's pinned files on the team's channel", () => {
  it("a file already there is left alone; one the network gives wrong is not kept, and the publish goes on", async () => {
    const channel = mkdtempSync(join(tmpdir(), "testimus-channel-"));
    mkdirSync(join(channel, "runtimes"));
    const there = join(channel, "runtimes", VAD_MODEL.name);
    writeFileSync(there, "");
    truncateSync(there, VAD_MODEL.size);
    const asked: string[] = [];
    llamaIo.download = async (url, file) => {
      asked.push(url);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, "not the pinned build");
    };
    const said: string[] = [];
    const kept = await keepOnChannel(channel, (line) => said.push(line), new AbortController().signal);
    expect(kept).toEqual([VAD_MODEL.name]);
    expect(asked.map((u) => u.split("/").at(-1))).toEqual([WHISPER_ASSETS.cpu.name, WHISPER_ASSETS.cuda.name]);
    expect(readdirSync(join(channel, "runtimes"))).toEqual([VAD_MODEL.name]);
    expect(existsSync(join(channel, "runtimes", `${WHISPER_ASSETS.cpu.name}.part`))).toBe(false);
    expect(said.filter((l) => l.includes("was not kept on the channel")).length).toBe(2);
    expect(said.join("\n")).toContain("does not match its pinned SHA-256");
  });
});
