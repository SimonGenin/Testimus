// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShellPage } from "../../../src/desktop/bridge-types.ts";

const html = readFileSync(join(import.meta.dirname, "..", "..", "..", "src", "desktop", "pages", "error.html"), "utf8");
const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/)?.[1] ?? "";

const load = async (shell: ShellPage | undefined) => {
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, "");
  window.testimusShell = shell;
  vi.resetModules();
  await import("../../../src/desktop/pages/error.ts");
  await Promise.resolve();
  await Promise.resolve();
};

const text = (id: string) => document.getElementById(id)?.textContent;
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;

const fake = (lines: string[]) => ({
  details: vi.fn(async () => ({ message: "The core stopped (exit code 1).", lines, logDir: "C:\\L\\logs" })),
  restart: vi.fn(async () => {}),
  openLogs: vi.fn(async () => {}),
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("error page", () => {
  it("shows the error, the last core lines and the log folder", async () => {
    const s = fake(["line 1", "line 2"]);
    await load(s);
    expect(text("message")).toBe("The core stopped (exit code 1).");
    expect(text("lines")).toBe("line 1\nline 2");
    expect(text("where")).toBe("C:\\L\\logs");
    expect(document.activeElement).toBe(button("restart"));
  });

  it("says when the log is empty", async () => {
    await load(fake([]));
    expect(text("lines")).toBe("(the log is empty)");
  });

  it("restarts once and opens the logs", async () => {
    const s = fake([]);
    await load(s);
    button("restart").click();
    expect(button("restart").disabled).toBe(true);
    expect(s.restart).toHaveBeenCalledTimes(1);
    button("logs").click();
    button("logs").click();
    expect(s.openLogs).toHaveBeenCalledTimes(2);
  });

  it("disables both buttons outside the desktop shell", async () => {
    await load(undefined);
    expect(button("restart").disabled).toBe(true);
    expect(button("logs").disabled).toBe(true);
  });
});
