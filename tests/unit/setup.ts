import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configure } from "@testing-library/react";
import { afterAll, afterEach } from "vitest";
import { env } from "../../src/core/env.ts";
import { framesIo, stopFramesWorker } from "../../src/core/lib/frames/frames-process.ts";
import { clearDrafts } from "../../src/ui/lib/drafts.ts";

afterEach(() => clearDrafts());
// ponytail: a file whose pictures went through the frames worker leaves none behind it; the suite keeps every core
// busy at normal priority, where a worker below normal waited past the tests' timeouts
framesIo.priority = undefined;
afterAll(() => stopFramesWorker());

// ponytail: a findBy or waitFor gives the page 10 s, not 1 — a full run under coverage is slow, the assertions stay the same
configure({ asyncUtilTimeout: 10_000 });

const root = mkdtempSync(join(tmpdir(), "testimus-unit-"));
env.dataDir = () => join(root, "appdata");
env.localDir = () => join(root, "localappdata");
env.homeDir = () => join(root, "home");
env.http = async (req) => {
  throw new Error(`Unit tests never reach the network: ${req.method} ${req.url}`);
};
env.spawnClaude = async () => {
  throw new Error("Unit tests never run claude");
};
