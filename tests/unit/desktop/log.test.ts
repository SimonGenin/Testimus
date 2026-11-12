import { describe, expect, it } from "vitest";
import { dataDir, expired, localDir, logDir, logName } from "../../../src/desktop/log.ts";

describe("desktop logs", () => {
  it("names one file per day under LOCALAPPDATA\\Testimus\\logs", () => {
    expect(logName(new Date("2026-11-02T10:00:00Z"))).toBe("desktop-2026-11-02.log");
    const env = { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local", APPDATA: "C:\\Users\\u\\AppData\\Roaming" };
    expect(logDir(env)).toMatch(/Local[\\/]Testimus[\\/]logs$/);
    expect(localDir(env)).toMatch(/Local[\\/]Testimus$/);
    expect(dataDir(env)).toMatch(/Roaming[\\/]Testimus$/);
  });

  it("the unit tests write their journal under the run's temporary root, never the real one (global-setup.ts)", () => {
    expect(process.env.LOCALAPPDATA).toMatch(/testimus-vitest-[^\\/]+[\\/]localappdata$/);
    expect(logDir()).toContain(process.env.LOCALAPPDATA);
  });

  it("keeps 14 days and touches no other file", () => {
    const now = new Date("2026-11-20T08:00:00Z");
    const names = [
      "desktop-2026-11-20.log",
      "desktop-2026-11-06.log",
      "desktop-2026-11-05.log",
      "desktop-2025-01-01.log",
      "other.log",
      "desktop-x.log",
    ];
    expect(expired(names, now)).toEqual(["desktop-2026-11-05.log", "desktop-2025-01-01.log"]);
  });
});
