// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setProject } from "../../../../src/ui/api.ts";
import { cx, initials, message, plural, relTime } from "../../../../src/ui/lib/format.ts";
import { fakeNet } from "../../cov-uishell-helpers.tsx";
import { noDesktop } from "../../ui-desktop-helpers.tsx";

beforeEach(() => fakeNet());

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  noDesktop();
  setProject(null);
  localStorage.clear();
  sessionStorage.clear();
});

describe("format", () => {
  it("formats messages, classes, plurals and initials", () => {
    expect(message(new Error("boom"))).toBe("boom");
    expect(message(42)).toBe("42");
    expect(cx("a", false, null, undefined, "b")).toBe("a b");
    expect(plural(1, "test")).toBe("1 test");
    expect(plural(2, "test")).toBe("2 tests");
    expect(initials("RATP Sosie Ligne")).toBe("RS");
    expect(initials("   ")).toBe("?");
  });

  it("says a time relative to now in the right unit", () => {
    const now = Date.now();
    expect(relTime(now - 10_000)).toMatch(/s/);
    expect(relTime(now - 5 * 60_000)).toMatch(/5\s?m/);
    expect(relTime(now - 3 * 3_600_000)).toMatch(/3\s?h/);
    expect(relTime(now - 3 * 86_400_000)).toMatch(/3\s?d/);
  });
});
