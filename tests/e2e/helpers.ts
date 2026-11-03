import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
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

// ponytail: other sessions run this suite on the same PC at the same time — a spec's port may already be held by
// their server, and the spec would quietly test (and lose) someone else's sandbox; the first free port from the
// preferred one on is taken instead, and the readiness check asks our own child
function freePort(preferred: number): number {
  const probe = `const net=require("node:net");const t=(p)=>{const s=net.createServer();s.once("error",()=>t(p+1));s.listen(p,"127.0.0.1",()=>{s.close(()=>process.stdout.write(String(p)))})};t(${preferred});`;
  const out = spawnSync(process.execPath, ["-e", probe], { encoding: "utf8" }).stdout.trim();
  return Number(out) || preferred;
}

export function mockServer(preferred: number, extraEnv: Record<string, string> = {}): { url: string } {
  const port = freePort(preferred);
  const url = `http://localhost:${port}`;
  let child: ChildProcess | null = null;
  test.use({ baseURL: url });
  test.beforeAll(async () => {
    // ponytail: a port moved off its preferred value can be one an earlier spec used — its session cookie is stale
    sessions.delete(url);
    child = spawn(
      process.execPath,
      [join(ROOT, "src", "faces", "cli.ts"), "serve", "--mock", "--port", String(port), "--no-open"],
      { cwd: ROOT, env: { ...process.env, ...extraEnv }, stdio: "ignore" },
    );
    let exited: number | null = null;
    child.once("exit", (code) => {
      exited = code ?? -1;
    });
    const until = Date.now() + 30_000;
    while (Date.now() < until) {
      if (exited !== null)
        throw new Error(`testimus serve --mock on ${url} exited (${exited}) — port taken meanwhile?`);
      try {
        const r = await fetch(`${url}/api/system/version`);
        if (r.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`testimus serve --mock did not answer on ${url}`);
  });
  test.afterAll(() => {
    child?.kill();
    child = null;
  });
  return { url };
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
  await expect(dock.getByRole("heading", { name: "Ask Claude" })).toBeVisible();
  return dock;
}

export async function openTest(page: Page, key: string): Promise<void> {
  await boot(page, `#/tests/${key}`);
  await expect(page.getByRole("main").getByRole("article", { name: "Step 1" })).toBeVisible();
}

const THEME_LABEL = { system: "System", light: "Light", dark: "Dark" } as const;
export type Theme = keyof typeof THEME_LABEL;

export async function setTheme(page: Page, theme: Theme): Promise<void> {
  const toggle = page.getByRole("button", { name: /^Theme: / });
  for (let i = 0; i < 3; i++) {
    const name = (await toggle.getAttribute("aria-label")) ?? "";
    if (name.startsWith(`Theme: ${THEME_LABEL[theme]}.`)) break;
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-label", new RegExp(`^Theme: ${THEME_LABEL[theme]}\\.`));
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
