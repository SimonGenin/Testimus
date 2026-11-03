import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { env } from "../../src/core/env.ts";
import { clearDrafts } from "../../src/ui/lib/drafts.ts";

afterEach(() => clearDrafts());

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
