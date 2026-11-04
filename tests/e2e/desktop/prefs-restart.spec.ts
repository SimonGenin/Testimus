import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const MAIN = join(ROOT, "dist", "desktop", "main.mjs");

// ponytail: npm ci without install scripts leaves Electron without its binary — this spec then cannot run at all
function electronBinary(): string | null {
  try {
    const exe = createRequire(import.meta.url)("electron") as unknown as string;
    return existsSync(exe) ? exe : null;
  } catch {
    return null;
  }
}

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);
test.skip(!electronBinary(), "the Electron binary is not installed (npm install scripts were skipped)");

test.beforeAll(() => {
  execFileSync(process.execPath, [join(ROOT, "scripts", "desktop.ts"), "--build-only"], { cwd: ROOT, stdio: "ignore" });
});

type Run = { app: ElectronApplication; page: Page; origin: string };

function sandbox(): Record<string, string> {
  const tmp = mkdtempSync(join(tmpdir(), "testimus-prefs-restart-"));
  return {
    ...(process.env as Record<string, string>),
    APPDATA: join(tmp, "roaming"),
    LOCALAPPDATA: join(tmp, "local"),
    TESTIMUS_HOME: join(tmp, "home"),
  };
}

async function launch(env: Record<string, string>): Promise<Run> {
  const app = await _electron.launch({ args: [MAIN], cwd: ROOT, env, timeout: 60_000 });
  const page = await app.firstWindow();
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60_000 });
  return { app, page, origin: new URL(page.url()).origin };
}

async function darkTheme(page: Page): Promise<void> {
  await page.waitForURL(/#\/setup/, { timeout: 30_000 });
  await page.goto(`${new URL(page.url()).origin}/#/settings/appearance`);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Appearance" }).first()).toBeVisible();
  const toggle = page.getByRole("button", { name: /^Theme: / });
  for (let i = 0; i < 3; i++) {
    if ((await toggle.getAttribute("aria-label"))?.startsWith("Theme: Dark.")) break;
    await toggle.click();
  }
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
}

const theme = (page: Page) => page.evaluate(() => localStorage.getItem("testimus.theme"));

test("a preference chosen in the desktop app is there after the window restarts (PARITY #101)", async () => {
  const env = sandbox();
  const first = await launch(env);
  await darkTheme(first.page);
  await first.app.close();

  const second = await launch(env);
  expect(second.origin).toBe(first.origin);
  await expect(second.page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => theme(second.page).catch(() => null)).toBe("dark");
  await second.app.close();
});

test("when the core had to take another port, the preferences copied to settings.json come back (PARITY #101)", async () => {
  const env = sandbox();
  const first = await launch(env);
  await darkTheme(first.page);
  await expect
    .poll(
      () =>
        first.page
          .evaluate(async () => {
            const r = await fetch("/api/system/settings", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            });
            return ((await r.json()) as { ui?: Record<string, string> }).ui?.["testimus.theme"] ?? null;
          })
          // ponytail: the window may reload while the preferences settle; that read is asked again
          .catch(() => null),
      { timeout: 15_000 },
    )
    .toBe("dark");
  await first.app.close();

  const port = Number(new URL(first.origin).port);
  const taken: Server = createServer();
  await new Promise<void>((ok) => taken.listen(port, "127.0.0.1", ok));
  try {
    const second = await launch(env);
    expect(second.origin).not.toBe(first.origin);
    await expect(second.page.locator("html")).toHaveAttribute("data-theme", "dark", { timeout: 20_000 });
    await expect.poll(() => theme(second.page).catch(() => null)).toBe("dark");
    await second.app.close();
  } finally {
    await new Promise<void>((ok) => taken.close(() => ok()));
  }
});
