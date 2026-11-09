import { execFileSync, spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const MAIN = join(ROOT, "dist", "desktop", "main.mjs");
const SCREENS = join(ROOT, "tests", "screens");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;

type Shell = { app: ElectronApplication; page: Page; env: NodeJS.ProcessEnv; local: string };

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

test.beforeAll(() => {
  execFileSync(process.execPath, [join(ROOT, "scripts", "desktop.ts"), "--build-only"], { cwd: ROOT, stdio: "ignore" });
});

async function launch(extraEnv: Record<string, string> = {}): Promise<Shell> {
  const tmp = mkdtempSync(join(tmpdir(), "testimus-desktop-e2e-"));
  const local = join(tmp, "local");
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: join(tmp, "roaming"), LOCALAPPDATA: local, ...extraEnv };
  const app = await _electron.launch({
    args: [MAIN, "--mock"],
    cwd: ROOT,
    env: env as Record<string, string>,
    timeout: 60_000,
  });
  const page = await app.firstWindow();
  return { app, page, env, local };
}

async function untilCore(page: Page): Promise<string> {
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60_000 });
  return new URL(page.url()).origin;
}

function logText(local: string): string {
  const dir = join(local, "Testimus", "logs");
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((f) => f.startsWith("desktop-"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("");
}

function corePid(local: string): number {
  const m = logText(local).match(/core ready on \S+ \(pid (\d+)/);
  if (!m) throw new Error("no ready line in the desktop log");
  return Number(m[1]);
}

// ponytail: the program's name while the pid lives — tasklist on Windows, ps elsewhere (a zombie counts as gone)
function running(pid: number): string | null {
  if (process.platform !== "win32") {
    const out = spawnSync("ps", ["-p", String(pid), "-o", "stat=,comm="], { encoding: "utf8" }).stdout.trim();
    const m = out.match(/^(\S+)\s+(.+)$/);
    return m && !m[1].startsWith("Z") ? basename(m[2]) : null;
  }
  const out = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" }).stdout;
  const m = out.match(/^"([^"]+)","(\d+)"/m);
  return m && Number(m[2]) === pid ? m[1] : null;
}

function killTree(pid: number): void {
  if (process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)]);
  else
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
}

async function call<T>(page: Page, name: string, input: unknown = {}, project?: string): Promise<T> {
  return page.evaluate(
    async ([n, i, p]) => {
      const [g, v] = (n as string).split(".");
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (p) headers["X-Testimus-Project"] = encodeURIComponent(p as string);
      const r = await fetch(`/api/${g}/${v}`, { method: "POST", headers, body: JSON.stringify(i) });
      return r.json();
    },
    [name, input, project] as const,
  ) as Promise<T>;
}

async function shoot(page: Page, name: string, ui: boolean): Promise<void> {
  mkdirSync(SCREENS, { recursive: true });
  for (const t of ["light", "dark"] as const) {
    if (ui)
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        localStorage.setItem("testimus.theme", theme);
        window.dispatchEvent(new CustomEvent("testimus:theme", { detail: theme }));
      }, t);
    else await page.emulateMedia({ colorScheme: t });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(SCREENS, `${name}-${t}.png`), animations: "disabled" });
  }
  if (ui)
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
      localStorage.setItem("testimus.theme", "light");
      window.dispatchEvent(new CustomEvent("testimus:theme", { detail: "light" }));
    });
  else await page.emulateMedia({ colorScheme: null });
}

async function quit(shell: Shell): Promise<void> {
  const exited = new Promise<void>((r) => {
    if (shell.app.process().exitCode !== null) r();
    else shell.app.process().once("exit", () => r());
  });
  await shell.app
    .evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.close();
    })
    .catch(() => {});
  await exited;
}

test("the window opens on the splash, reaches Documents, and is locked down", async () => {
  const shell = await launch();
  const { app, page } = shell;
  try {
    await expect(page).toHaveTitle("Testimus");
    const origin = await untilCore(page);
    await page.evaluate(() => {
      location.hash = "#/documents";
    });
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible({ timeout: 30_000 });
    // ponytail: the list is a section on a wide window and its strip on a narrower one; the first window reloads once
    // to take its mirrored preferences back, which can swallow a click — so open it until it holds
    const list = page.getByRole("navigation", { name: /collapsed$/ }).getByRole("button", { name: /^Documents/ });
    const rows = page.getByRole("region", { name: "Document list" }).getByRole("option", { name: /SOSIE_/ });
    await expect(async () => {
      if (await list.isVisible()) await list.click();
      await expect(rows).toHaveCount(2, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^Project LFRPS12/ })).toBeVisible();

    expect(logText(shell.local)).toContain("core ready on http://127.0.0.1:");
    const version = await call<{ shell?: string; version: string }>(page, "system.version");
    expect(version.version).toBeTruthy();

    const exposed = await page.evaluate(() => ({
      bridge: typeof window.testimusDesktop,
      shellPage: typeof window.testimusShell,
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
    }));
    expect(exposed).toEqual({ bridge: "object", shellPage: "undefined", require: "undefined", process: "undefined" });
    const v = await page.evaluate(() => window.testimusDesktop?.version());
    expect(v?.electron).toBe("45.2.1");
    expect(v?.shell).toMatch(/^\d+\.\d+\.\d+/);
    await expect(
      page.evaluate(() => window.testimusDesktop?.openExternal("file:///C:/Windows/notepad.exe")),
    ).rejects.toThrow(/https/);

    const prefs = await app.evaluate(({ BrowserWindow, Menu }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const menus = Menu.getApplicationMenu()?.items.map((i) => i.label) ?? [];
      return { menu: w.isMenuBarVisible(), title: w.getTitle(), menus };
    });
    if (process.platform === "darwin") expect(prefs.menus).toEqual(["Edit", "View"]);
    else expect(prefs.menu).toBe(false);
    expect(prefs.title).toBe(await page.title());

    await page.evaluate(() => document.fonts.ready);
    await shoot(page, "desktop-window", true);

    await app.evaluate(({ shell: s }) => {
      const g = globalThis as unknown as { opened: string[] };
      g.opened = [];
      s.openExternal = async (url: string) => {
        g.opened.push(url);
      };
    });
    await page.evaluate(() => {
      const a = document.createElement("a");
      a.href = "https://example.com/elsewhere";
      a.textContent = "away";
      document.body.append(a);
      a.click();
    });
    await page.waitForTimeout(500);
    expect(new URL(page.url()).origin).toBe(origin);

    await page.evaluate(() => {
      window.open("https://id.atlassian.com/manage-profile/security/api-tokens", "_blank");
      window.open("http://example.com/plain-http", "_blank");
    });
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened))
      .toEqual(["https://id.atlassian.com/manage-profile/security/api-tokens"]);
    expect(app.windows()).toHaveLength(1);

    const child = app.waitForEvent("window");
    await page.evaluate(() => window.open("/files/project.json", "_blank"));
    const files = await child;
    await files.waitForLoadState();
    expect(await files.evaluate(() => typeof window.testimusDesktop)).toBe("undefined");
    expect(await files.evaluate(() => document.body.textContent)).toContain("LFRPS12");
    await files.close();

    const perm = await page.evaluate(() =>
      navigator.permissions.query({ name: "geolocation" as PermissionName }).then((p) => p.state),
    );
    expect(perm).not.toBe("granted");
  } finally {
    await quit(shell);
  }
});

test("pickFolder (stubbed in the main process) opens a project; a second launch hands its folder to the window", async () => {
  const shell = await launch();
  const { app, page } = shell;
  try {
    await untilCore(page);
    const dir = mkdtempSync(join(tmpdir(), "testimus-desktop-proj-"));
    cpSync(join(ROOT, "tests", "fixtures", "project"), dir, { recursive: true });
    const pj = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
    writeFileSync(join(dir, "project.json"), JSON.stringify({ ...pj, name: "Desktop proof", jiraProject: "DESK" }));

    await app.evaluate(({ dialog, shell: s }, picked) => {
      const g = globalThis as unknown as { asked: unknown[]; revealed: string[] };
      g.asked = [];
      g.revealed = [];
      dialog.showOpenDialog = (async (...a: unknown[]) => {
        g.asked.push(a[a.length - 1]);
        return { canceled: false, filePaths: [picked] };
      }) as typeof dialog.showOpenDialog;
      s.showItemInFolder = (p: string) => {
        g.revealed.push(p);
      };
      s.openPath = async (p: string) => {
        g.revealed.push(p);
        return "";
      };
    }, dir);

    const picked = await page.evaluate(() => window.testimusDesktop?.pickFolder({ title: "Open a project" }));
    expect(picked).toBe(dir);
    const asked = await app.evaluate(() => (globalThis as unknown as { asked: unknown[] }).asked);
    expect(asked[0]).toMatchObject({ title: "Open a project", properties: expect.arrayContaining(["openDirectory"]) });

    const opened = await call<{ dir: string; jiraProject: string }>(page, "project.open", { dir: picked });
    expect(opened.jiraProject).toBe("DESK");
    await page.evaluate((d) => localStorage.setItem("testimus.project", d), dir);
    await page.reload();
    await expect(page.getByRole("button", { name: /^Project DESK Desktop proof/ })).toBeVisible({ timeout: 30_000 });

    const outside = process.platform === "win32" ? "C:\\Windows\\System32" : "/usr/bin";
    expect(await page.evaluate((p) => window.testimusDesktop?.reveal(p), join(dir, "project.json"))).toBe(true);
    expect(await page.evaluate((p) => window.testimusDesktop?.reveal(p), outside)).toBe(false);
    expect(await app.evaluate(() => (globalThis as unknown as { revealed: string[] }).revealed)).toEqual([
      join(dir, "project.json"),
    ]);

    const files = await page.evaluate(() =>
      window.testimusDesktop?.pickFiles({
        title: "Add documents",
        filters: [{ name: "Documents", extensions: ["docx", "pdf"] }],
        multiple: true,
      }),
    );
    expect(files).toEqual([dir]);
    await page.evaluate(() => window.testimusDesktop?.setProgress(0.4));
    await page.evaluate(() => window.testimusDesktop?.setProgress(null));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus());
    if (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFocused()))
      expect(await page.evaluate(() => window.testimusDesktop?.notify({ title: "Testimus", body: "not shown" }))).toBe(
        false,
      );
    await expect(
      page.evaluate(() => window.testimusDesktop?.notify({ title: "" as string, body: "x" })),
    ).rejects.toThrow(/title/);

    await page.evaluate(() => {
      const g = window as unknown as { openedProject?: string };
      window.testimusDesktop?.onOpenProject((d) => {
        g.openedProject = d;
      });
    });
    const second = spawn(ELECTRON, [MAIN, "--mock", dir], { cwd: ROOT, env: shell.env, stdio: "ignore" });
    const code = await new Promise<number | null>((r) => second.once("exit", r));
    expect(code).toBe(0);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { openedProject?: string }).openedProject), {
        timeout: 15_000,
      })
      .toBe(dir);
  } finally {
    await quit(shell);
  }
});

test("quitting with a running job asks first, then cancels it and leaves no process", async () => {
  const shell = await launch();
  const { app, page } = shell;
  const launcherPid = app.process().pid ?? 0;
  const electronPid = await app.evaluate(() => process.pid);
  let core = 0;
  try {
    await untilCore(page);
    core = corePid(shell.local);
    await quitAsks(shell, [launcherPid, electronPid], core);
  } finally {
    for (const pid of [launcherPid, electronPid]) if (running(pid)) killTree(pid);
    if (core && running(core)) killTree(core);
  }
});

async function quitAsks(shell: Shell, [launcherPid, electronPid]: number[], core: number): Promise<void> {
  const { app, page } = shell;
  expect(running(core)).toMatch(/^node(\.exe)?$/i);
  expect(running(electronPid)).toMatch(/^electron(\.exe)?$/i);

  const { last: project } = await call<{ last: string }>(page, "project.list");
  const { jobId } = await call<{ jobId: string }>(page, "gen.tests", { request: "Le disjoncteur à distance" }, project);
  expect(jobId).toBeTruthy();

  await app.evaluate(({ dialog }) => {
    const g = globalThis as unknown as {
      boxes: { message: string; detail: string; buttons: string[] }[];
      answers: number[];
    };
    g.boxes = [];
    g.answers = [1, 0];
    dialog.showMessageBox = (async (...a: unknown[]) => {
      const o = a[a.length - 1] as { message: string; detail: string; buttons: string[] };
      g.boxes.push({ message: o.message, detail: o.detail, buttons: o.buttons });
      return { response: g.answers.shift() ?? 1, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
  });

  const boxes = () =>
    app.evaluate(
      () => (globalThis as unknown as { boxes: { message: string; detail: string; buttons: string[] }[] }).boxes,
    );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect.poll(async () => (await boxes()).length).toBe(1);
  const [box] = await boxes();
  expect(box.message).toBe("A job is still running.");
  expect(box.detail).toContain("Generate tests · Le disjoncteur à distance");
  expect(box.buttons).toEqual(["Cancel and quit", "Keep working"]);
  await page.waitForTimeout(300);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(true);
  expect(running(core)).not.toBeNull();

  const exited = new Promise<void>((r) => app.process().once("exit", () => r()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await exited;

  await expect.poll(() => running(core), { timeout: 15_000 }).toBeNull();
  await expect.poll(() => running(electronPid), { timeout: 15_000 }).toBeNull();
  await expect.poll(() => running(launcherPid), { timeout: 15_000 }).toBeNull();
  const log = readFileSync(join(project, ".testimus", "jobs", `${jobId}.jsonl`), "utf8")
    .trim()
    .split("\n");
  const statuses = log
    .map((l) => JSON.parse(l) as { type: string; job?: { status: string } })
    .filter((e) => e.type === "status");
  expect(statuses.at(-1)?.job?.status).toBe("cancelled");
  expect(logText(shell.local)).toContain("quit: keep working");
  expect(logText(shell.local)).toContain("quit: cancel and quit");
}

test("a core that cannot start shows the error page with its log, Restart and the log folder", async () => {
  const notNode = process.platform === "win32" ? "C:\\Windows\\System32\\where.exe" : "/usr/bin/which";
  const shell = await launch({ TESTIMUS_NODE: notNode });
  const { app, page } = shell;
  try {
    await expect(page.getByRole("heading", { name: "Testimus could not start" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#message")).toContainText(/stopped .*before it was ready/);
    await expect(page.getByRole("log")).not.toHaveText("");
    await expect(page.locator("#where")).toHaveText(join(shell.local, "Testimus", "logs"));
    expect(await page.evaluate(() => typeof window.testimusDesktop)).toBe("undefined");
    await shoot(page, "desktop-error", false);

    await app.evaluate(({ shell: s }) => {
      const g = globalThis as unknown as { paths: string[] };
      g.paths = [];
      s.openPath = async (p: string) => {
        g.paths.push(p);
        return "";
      };
    });
    await page.getByRole("button", { name: "Open the log folder" }).click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as unknown as { paths: string[] }).paths))
      .toEqual([join(shell.local, "Testimus", "logs")]);

    await page.getByRole("button", { name: "Restart" }).click();
    await expect(page.getByRole("button", { name: "Restart" })).toBeEnabled({ timeout: 30_000 });
    expect(logText(shell.local).match(/starting the core/g)?.length).toBe(2);

    await app.evaluate(
      ({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].loadFile(file),
      join(ROOT, "dist", "desktop", "pages", "splash.html"),
    );
    await expect(page.getByRole("heading", { name: "Testimus" })).toBeVisible();
    await shoot(page, "desktop-splash", false);
  } finally {
    await quit(shell);
  }
});
