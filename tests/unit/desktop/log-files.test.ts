import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTail,
  dataDir,
  KEEP_DAYS,
  lastLines,
  localDir,
  log,
  logDir,
  logName,
  pruneLogs,
  TAIL_LINES,
} from "../../../src/desktop/log.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "testimus-cov-log-"));
  vi.stubEnv("LOCALAPPDATA", join(root, "local"));
  vi.stubEnv("APPDATA", join(root, "roaming"));
  clearTail();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const today = () => readFileSync(join(logDir(), logName(new Date())), "utf8");

describe("desktop log folders", () => {
  it("falls back to the home folder when the Windows variables are missing", () => {
    expect(localDir({})).toBe(join(homedir(), ".local", "share", "Testimus"));
    expect(dataDir({})).toBe(join(homedir(), ".config", "Testimus"));
    expect(logDir({})).toBe(join(homedir(), ".local", "share", "Testimus", "logs"));
  });

  it("uses LOCALAPPDATA and APPDATA from the process by default", () => {
    expect(localDir()).toBe(join(root, "local", "Testimus"));
    expect(dataDir()).toBe(join(root, "roaming", "Testimus"));
    expect(logDir()).toBe(join(root, "local", "Testimus", "logs"));
  });
});

describe("log", () => {
  it("writes a timestamped line per source to today's file", () => {
    log("shell", "starting   ");
    log("core", "Testimus on http://127.0.0.1:1/\n");
    const text = today();
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[shell\] starting\n/);
    expect(text).toContain("[core] Testimus on http://127.0.0.1:1/\n");
  });

  it("skips empty lines", () => {
    log("core", "   ");
    log("shell", "");
    expect(existsSync(logDir())).toBe(false);
    expect(lastLines()).toEqual([]);
  });

  it("keeps the last core and ui-dev lines for the error page, never the shell's own", () => {
    log("shell", "shell line");
    log("ui-dev", "vite line");
    log("core", "core line");
    expect(lastLines()).toEqual(["vite line", "core line"]);
    const copy = lastLines();
    copy.push("x");
    expect(lastLines()).toHaveLength(2);
    clearTail();
    expect(lastLines()).toEqual([]);
  });

  it("keeps at most TAIL_LINES lines, dropping the oldest", () => {
    for (let i = 0; i < TAIL_LINES + 5; i++) log("core", `line ${i}`);
    const lines = lastLines();
    expect(lines).toHaveLength(TAIL_LINES);
    expect(lines[0]).toBe("line 5");
    expect(lines.at(-1)).toBe(`line ${TAIL_LINES + 4}`);
  });

  it("never throws when the log folder cannot be written", () => {
    writeFileSync(join(root, "blocker"), "x");
    vi.stubEnv("LOCALAPPDATA", join(root, "blocker"));
    expect(() => log("core", "still kept in memory")).not.toThrow();
    expect(lastLines()).toEqual(["still kept in memory"]);
  });
});

describe("pruneLogs", () => {
  it("removes the log files older than the kept days and nothing else", () => {
    const dir = logDir();
    mkdirSync(dir, { recursive: true });
    const now = new Date("2026-11-20T08:00:00Z");
    const old = new Date(now.getTime() - (KEEP_DAYS + 3) * 86_400_000);
    writeFileSync(join(dir, logName(now)), "today\n");
    writeFileSync(join(dir, logName(old)), "old\n");
    writeFileSync(join(dir, "notes.txt"), "keep\n");
    mkdirSync(join(dir, "desktop-2020-01-01.log"));
    pruneLogs(now);
    expect(readdirSync(dir).sort()).toEqual([logName(now), "desktop-2020-01-01.log", "notes.txt"].sort());
  });

  it("does nothing when there is no log folder yet", () => {
    expect(() => pruneLogs()).not.toThrow();
    expect(existsSync(logDir())).toBe(false);
  });
});
