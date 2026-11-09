import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addUnreleased, notesOf, parseChangelog, releaseChangelog } from "../src/core/lib/changelog.ts";
import { publishFolder, publishRelease, ROOT, release, uncPath } from "./release.ts";

export const VERSION = /^\d+\.\d+\.\d+$/;

export function publishArgs(argv: string[]): { version: string; notes: string; to: string } {
  const value = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : "";
  };
  const flagged = new Set(["--notes", "--to"].map((f) => argv.indexOf(f) + 1).filter((i) => i > 0));
  const version = argv.find((a, i) => !a.startsWith("--") && !flagged.has(i)) ?? "";
  if (!VERSION.test(version))
    throw new Error(`Give the version as x.x.x: npm run publish 0.0.6 (got "${version || "nothing"}").`);
  return { version, notes: value("--notes"), to: value("--to") };
}

// ponytail: the folder PCs install from, read as the app reads it — Settings › Updates, else the channel this PC's
// installed copy follows (install.json)
export function installChannel(localDir: string): string {
  const file = join(localDir, "install.json");
  if (!existsSync(file)) return "";
  const info = JSON.parse(readFileSync(file, "utf8").replace(/^﻿/, "")) as { channel?: unknown };
  return typeof info.channel === "string" ? info.channel : "";
}

export async function alreadyPublished(folder: string, version: string): Promise<string | null> {
  const named = join(folder, `testimus-${version}-win-x64`);
  if (existsSync(named)) return named;
  if (!existsSync(folder)) return null;
  const { scanReleases } = await import("../src/core/lib/updates.ts");
  return (await scanReleases(folder)).find((r) => r.version === version)?.folder ?? null;
}

export function withVersion(packageJson: string, version: string): string {
  return packageJson.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`);
}

// ponytail: the version takes CHANGELOG.md's « Unreleased » lines (and --notes as one more line); its notes are those lines
export function changelogFor(text: string, version: string, notes: string): { text: string; notes: string } {
  const next = releaseChangelog(addUnreleased(text, notes), version);
  return { text: next, notes: notesOf(parseChangelog(next).find((e) => e.version === version)?.items ?? []) };
}

// ponytail: npm run publish <x.x.x> [-- --notes "what is new"] [-- --to <shared folder>] — refuses a version the
// folder already holds or a CHANGELOG.md with nothing under « Unreleased » before building anything, sets package.json's
// version and the changelog's, builds the release and publishes it; a failed build puts both back
if (import.meta.main) {
  (async () => {
    const args = publishArgs(process.argv.slice(2));
    const { readSettings } = await import("../src/core/lib/project.ts");
    const { env } = await import("../src/core/env.ts");
    const folder = publishFolder(args.to, readSettings().updates?.from || installChannel(env.localDir()));
    const there = await alreadyPublished(folder, args.version);
    if (there) throw new Error(`release ${args.version} already exists: ${there}`);
    const pkgFile = join(ROOT, "package.json");
    const logFile = join(ROOT, "CHANGELOG.md");
    const before = readFileSync(pkgFile, "utf8");
    const log = readFileSync(logFile, "utf8");
    const next = changelogFor(log, args.version, args.notes);
    writeFileSync(pkgFile, withVersion(before, args.version));
    writeFileSync(logFile, next.text);
    let out = "";
    try {
      out = await release({ reuseUi: false, skipNode: false, notes: next.notes });
    } catch (e) {
      writeFileSync(pkgFile, before);
      writeFileSync(logFile, log);
      throw e;
    }
    const channel = uncPath(folder);
    process.stdout.write(`published to ${publishRelease(out, folder, channel)}; installs look in ${channel}\n`);
  })().catch((e) => {
    process.stderr.write(`publish failed: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
