import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { test as base, expect, type Page } from "@playwright/test";

export { expect };

const ROOT = join(import.meta.dirname, "..", "..");
export const SCREENS_DIR = join(ROOT, "tests", "screens");

type Guard = { allow: (pattern: RegExp) => void };

export const test = base.extend<{ consoleGuard: Guard }>({
  consoleGuard: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const allowed: RegExp[] = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(`console: ${m.text()}`);
      });
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("response", (r) => {
        if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.request().method()} ${r.url()}`);
      });
      await use({ allow: (p) => allowed.push(p) });
      const left = errors.filter((e) => !allowed.some((p) => p.test(e)));
      expect(left, "no console error and no uncaught exception").toEqual([]);
    },
    { auto: true },
  ],
});

// ponytail: other sessions run this suite on the same PC at the same time, on the same preferred ports — a port probed
// free could be taken while our server built its sandbox, and the readiness check then got its answer from their
// server: the spec quietly tested (and changed) someone else's sandbox. The server takes the preferred port or any free
// one (--port-fallback, as the desktop shell starts it) and names it on its own ready line, where the spec reads its url
export function mockServer(preferred: number, extraEnv: Record<string, string> = {}): { readonly url: string } {
  let url = "";
  let child: ChildProcess | null = null;
  // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from its first parameter
  test.use({ baseURL: async ({}, use) => use(url) });
  test.beforeAll(async () => {
    const started = spawn(
      process.execPath,
      [
        join(ROOT, "src", "faces", "cli.ts"),
        "serve",
        "--mock",
        "--port",
        String(preferred),
        "--port-fallback",
        "--no-open",
        "--ready-json",
      ],
      { cwd: ROOT, env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "ignore"] },
    );
    child = started;
    const ready = await new Promise<{ url: string; pid: number }>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error("testimus serve --mock did not say it was ready")), 30_000);
      started.once("exit", (code) => {
        clearTimeout(timer);
        fail(new Error(`testimus serve --mock exited (${code ?? -1}) before it was ready`));
      });
      createInterface({ input: started.stdout as Readable }).once("line", (line) => {
        clearTimeout(timer);
        ok(JSON.parse(line));
      });
    });
    if (ready.pid !== started.pid) throw new Error(`the ready line came from pid ${ready.pid}, not ours`);
    url = `http://localhost:${new URL(ready.url).port}`;
    // ponytail: a port off its preferred value can be one an earlier spec used — its session cookie is stale
    sessions.delete(url);
  });
  test.afterAll(() => {
    child?.kill();
    child = null;
  });
  return {
    get url() {
      if (!url) throw new Error("the mock server starts in beforeAll — read its url inside a test");
      return url;
    },
  };
}

const sessions = new Map<string, string>();

async function session(baseURL: string): Promise<string> {
  const known = sessions.get(baseURL);
  if (known) return known;
  const r = await fetch(`${baseURL}/`);
  const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  sessions.set(baseURL, cookie);
  return cookie;
}

export async function api<T = unknown>(baseURL: string, name: string, input: unknown = {}): Promise<T> {
  const [group, verb] = name.split(".");
  const r = await fetch(`${baseURL}/api/${group}/${verb}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: await session(baseURL) },
    body: JSON.stringify(input),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`${name} → ${r.status} ${JSON.stringify(body)}`);
  return body as T;
}

export async function waitForJob<T = unknown>(baseURL: string, jobId: string): Promise<T> {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    const shown = await api<{ job: { status: string; result?: T } }>(baseURL, "jobs.show", { id: jobId });
    if (shown.job.status !== "running" && shown.job.status !== "queued") return shown.job.result as T;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`job ${jobId} did not end`);
}

export async function boot(page: Page, hash = "#/tests"): Promise<void> {
  await page.goto(`/${hash}`);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Project LFRPS12/ })).toBeVisible();
}

export async function openDock(page: Page) {
  const dock = page.getByRole("complementary", { name: "Claude" });
  await dock.getByRole("button", { name: "Open Claude" }).click();
  await expect(dock.getByRole("heading", { name: "Claude", exact: true })).toBeVisible();
  return dock;
}

// ponytail: only validated tests open in Tests — a generated one still in review is validated first
export async function openTest(page: Page, key: string): Promise<void> {
  await boot(page, "#/generate");
  await page.evaluate(async (id) => {
    const r = await fetch("/api/review/set", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, decision: "validate" }),
    });
    if (!r.ok) throw new Error(`review.set ${id} → ${r.status}`);
  }, key);
  await page.goto(`/#/tests/${key}`);
  await expect(page.getByRole("main").getByRole("article", { name: "Step 1" })).toBeVisible();
}

export type Theme = "system" | "light" | "dark";

// ponytail: the theme preference written as another window of the profile would (Settings › Appearance is the only
// control, and the screen under test stays where it is)
export async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    if (t === "system") localStorage.removeItem("testimus.theme");
    else localStorage.setItem("testimus.theme", t);
    window.dispatchEvent(new StorageEvent("storage", { key: "testimus.theme" }));
  }, theme);
  if (theme === "system") await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
  else await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

async function applyTheme(page: Page, theme: Theme): Promise<void> {
  await page.evaluate((t) => {
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    localStorage.setItem("testimus.theme", t);
    window.dispatchEvent(new CustomEvent("testimus:theme", { detail: t }));
  }, theme);
  if (theme !== "system") await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

export async function shoot(page: Page, name: string, themes: Theme[] = ["light", "dark"]): Promise<void> {
  mkdirSync(SCREENS_DIR, { recursive: true });
  await page.mouse.move(0, 0);
  for (const t of themes) {
    await applyTheme(page, t);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(SCREENS_DIR, `${name}-${t}.png`), animations: "disabled" });
  }
  await applyTheme(page, "light");
}
