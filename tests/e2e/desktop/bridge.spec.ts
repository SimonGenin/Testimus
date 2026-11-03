import { execFileSync, spawn } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron, type ElectronApplication, expect, type Page, test } from "@playwright/test";
import { sampleDocx } from "../../fixtures/docx/sample.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const MAIN = join(ROOT, "dist", "desktop", "main.mjs");
const SCREENS = join(ROOT, "tests", "screens");
const ELECTRON = createRequire(import.meta.url)("electron") as unknown as string;

type Shell = { app: ElectronApplication; page: Page; env: NodeJS.ProcessEnv; csp: string[] };
type Main = {
  picks: string[][];
  asked: { title?: string; properties?: string[]; filters?: unknown }[];
  revealed: string[];
  opened: string[];
  progress: number[];
  notes: { title: string; body: string }[];
};

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

test.beforeAll(() => {
  execFileSync(process.execPath, [join(ROOT, "scripts", "desktop.ts"), "--build-only"], { cwd: ROOT, stdio: "ignore" });
});

async function launch(): Promise<Shell> {
  const tmp = mkdtempSync(join(tmpdir(), "testimus-bridge-e2e-"));
  const env: NodeJS.ProcessEnv = { ...process.env, APPDATA: join(tmp, "roaming"), LOCALAPPDATA: join(tmp, "local") };
  const app = await _electron.launch({ args: [MAIN, "--mock"], cwd: ROOT, env: env as Record<string, string> });
  const page = await app.firstWindow();
  const csp: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to (load|apply|execute|connect)/i.test(m.text())) csp.push(m.text());
  });
  await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 60_000 });
  return { app, page, env, csp };
}

async function stubMain(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow, dialog, Notification, shell }) => {
    const g = globalThis as unknown as { k: Main };
    g.k = { picks: [], asked: [], revealed: [], opened: [], progress: [], notes: [] };
    dialog.showOpenDialog = (async (...a: unknown[]) => {
      g.k.asked.push(a[a.length - 1] as Main["asked"][number]);
      const next = g.k.picks.shift();
      return next ? { canceled: false, filePaths: next } : { canceled: true, filePaths: [] };
    }) as typeof dialog.showOpenDialog;
    shell.showItemInFolder = (p: string) => {
      g.k.revealed.push(p);
    };
    shell.openPath = async (p: string) => {
      g.k.revealed.push(p);
      return "";
    };
    shell.openExternal = async (url: string) => {
      g.k.opened.push(url);
    };
    const w = BrowserWindow.getAllWindows()[0];
    const set = w.setProgressBar.bind(w);
    w.setProgressBar = (v: number, o?: Electron.ProgressBarOptions) => {
      g.k.progress.push(v);
      set(v, o);
    };
    w.isFocused = () => false;
    Notification.prototype.show = function (this: Electron.Notification) {
      g.k.notes.push({ title: this.title, body: this.body });
    };
  });
}

const main = (app: ElectronApplication) => app.evaluate(() => (globalThis as unknown as { k: Main }).k);
const pick = (app: ElectronApplication, paths: string[]) =>
  app.evaluate((_e, p) => {
    (globalThis as unknown as { k: Main }).k.picks.push(p);
  }, paths);
const title = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle());

async function go(page: Page, hash: string): Promise<void> {
  await page.evaluate((h) => {
    location.hash = h;
  }, hash);
}

function projectCopy(name: string, key: string): string {
  const dir = join(mkdtempSync(join(tmpdir(), "testimus-bridge-proj-")), key);
  cpSync(join(ROOT, "tests", "fixtures", "project"), dir, { recursive: true });
  const pj = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
  writeFileSync(join(dir, "project.json"), JSON.stringify({ ...pj, name, jiraProject: key }));
  return dir;
}

async function shoot(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENS, { recursive: true });
  for (const t of ["light", "dark"] as const) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      localStorage.setItem("testimus.theme", theme);
      window.dispatchEvent(new CustomEvent("testimus:theme", { detail: theme }));
    }, t);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(SCREENS, `${name}-${t}.png`), animations: "disabled" });
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
    localStorage.setItem("testimus.theme", "light");
    window.dispatchEvent(new CustomEvent("testimus:theme", { detail: "light" }));
  });
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

test("Browse opens a project, the window takes its name, Show in Explorer reveals, a second launch switches", async () => {
  const shell = await launch();
  const { app, page } = shell;
  try {
    await stubMain(app);
    await go(page, "#/documents");
    await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => title(app)).toBe("Testimus — RATP Sosie");

    const csp = await page.evaluate(() => fetch("/").then((r) => r.headers.get("content-security-policy")));
    expect(csp).toContain("default-src 'self'");
    expect(await page.evaluate(() => document.documentElement.dataset.theme ?? "")).not.toBe("x");
    expect(
      await page.evaluate(async () => {
        await document.fonts.ready;
        return document.fonts.check("16px 'Lexend Variable'") && document.fonts.check("16px 'Source Sans 3 Variable'");
      }),
    ).toBe(true);

    const dir = projectCopy("Desktop proof", "DESK");
    await pick(app, [dir]);
    await page.getByRole("button", { name: /^Project LFRPS12/ }).click();
    await expect(page.getByRole("menuitem", { name: "Open a folder…" })).toBeVisible();
    await shoot(page, "desktop-project-menu");
    await page.getByRole("menuitem", { name: "Open a folder…" }).click();
    await expect(page.getByRole("button", { name: /^Project DESK Desktop proof/ })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => title(app)).toBe("Testimus — Desktop proof");
    expect((await main(app)).asked[0]).toMatchObject({
      title: "Open a project folder",
      properties: expect.arrayContaining(["openDirectory"]),
    });

    await page.getByRole("button", { name: /^Project DESK/ }).click();
    await page.getByRole("menuitem", { name: "Show in Explorer" }).click();
    await expect.poll(async () => (await main(app)).revealed).toEqual([dir]);

    await page.getByRole("button", { name: "Show the document list" }).click();
    const docs = page.getByRole("region", { name: "Document list" }).getByRole("row", { name: /^SOSIE_/ });
    await expect(docs).toHaveCount(2);
    await docs.first().click();
    const show = page.getByRole("button", { name: "Show in Explorer" });
    await expect(show).toBeVisible();
    await shoot(page, "desktop-documents");
    await show.click();
    await expect
      .poll(async () => (await main(app)).revealed[1] ?? "")
      .toMatch(new RegExp(`^${join(dir, "docs", "SOSIE_211_D401-1_").replace(/\\/g, "\\\\")}\\d$`));

    await go(page, "#/tests/LFRPS12-1398");
    await page.getByRole("button", { name: "Show the test in Explorer" }).click();
    await expect.poll(async () => (await main(app)).revealed[2]).toBe(join(dir, "tests", "LFRPS12-1398", "test.md"));

    const png = readFileSync(
      join(ROOT, "tests", "fixtures", "project", "tests", "LFRPS12-1420", "images", "fig-40.png"),
    );
    const action = page.getByRole("textbox", { name: "Action of step 1" }).first();
    await action.click();
    await action.evaluate(
      (el, bytes) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(bytes)], "pasted.png", { type: "image/png" }));
        el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
      },
      [...png],
    );
    const img = page.locator("img.imgblock-img").first();
    await expect(img).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => img.evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    await go(page, "#/setup/project");
    await pick(app, ["D:\\Tests"]);
    await page.getByRole("button", { name: "Browse for the projects folder" }).click();
    await expect(page.getByRole("textbox", { name: "Projects folder" })).toHaveValue("D:\\Tests");
    await page.getByRole("textbox", { name: "Name" }).fill("Nouveau projet");
    await expect(page.getByText("D:\\Tests\\Nouveau projet")).toBeVisible();
    await shoot(page, "desktop-setup-project");

    await go(page, "#/settings/claude");
    const browse = page.getByRole("button", { name: "Browse for the Claude program" });
    await browse.scrollIntoViewIfNeeded();
    await expect(browse).toBeEnabled();
    await shoot(page, "desktop-settings-appearance");

    await go(page, "#/import");
    await expect(page.getByRole("button", { name: "Choose a file" })).toBeVisible();

    const other = projectCopy("Second launch", "SEC");
    const second = spawn(ELECTRON, [MAIN, "--mock", other], { cwd: ROOT, env: shell.env, stdio: "ignore" });
    expect(await new Promise<number | null>((r) => second.once("exit", r))).toBe(0);
    await expect(page.getByRole("button", { name: /^Project SEC Second launch/ })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => title(app)).toBe("Testimus — Second launch");

    expect(shell.csp).toEqual([]);
    await page.evaluate(() => {
      const s = document.createElement("script");
      s.textContent = "window.inlineRan = true";
      document.body.append(s);
    });
    expect(await page.evaluate(() => (window as unknown as { inlineRan?: boolean }).inlineRan)).toBeUndefined();
    await expect.poll(() => shell.csp.length).toBeGreaterThan(0);
  } finally {
    await quit(shell);
  }
});

test("documents go to the core by path, the taskbar follows the jobs, their end is notified", async () => {
  const shell = await launch();
  const { app, page } = shell;
  try {
    await stubMain(app);
    await go(page, "#/documents");
    // ponytail: an added document opens, and under 1300px the list folds into a drawer — the rows are counted there
    const rows = page
      .getByRole("region", { name: "Document list", includeHidden: true })
      .getByRole("row", { name: /^SOSIE_/, includeHidden: true });
    await expect(rows).toHaveCount(2, { timeout: 30_000 });

    const bodies: unknown[] = [];
    page.on("request", (r) => {
      if (r.url().endsWith("/api/docs/add")) bodies.push(JSON.parse(r.postData() ?? "null"));
    });
    const dir = mkdtempSync(join(tmpdir(), "testimus-bridge-docs-"));
    const picked = join(dir, "SOSIE_211_D401-1_9.docx");
    writeFileSync(picked, sampleDocx());
    await pick(app, [picked]);
    await page.getByRole("button", { name: "Add documents" }).click();
    await expect(rows).toHaveCount(3, { timeout: 60_000 });
    expect((await main(app)).asked.at(-1)).toMatchObject({
      title: "Add documents",
      filters: [{ name: "Word or PDF", extensions: ["docx", "pdf"] }],
      properties: expect.arrayContaining(["multiSelections"]),
    });
    expect(bodies).toEqual([{ file: picked, convert: false }]);

    const dropped = join(dir, "SOSIE_212_D402-1_2.docx");
    writeFileSync(dropped, sampleDocx({ extraParagraph: "Dropped from Explorer." }));
    await page.locator('input[type="file"]').setInputFiles(dropped);
    await expect(rows).toHaveCount(4, { timeout: 60_000 });
    expect(bodies).toEqual([
      { file: picked, convert: false },
      { file: dropped, convert: false },
    ]);

    await expect.poll(async () => (await main(app)).progress.at(-1), { timeout: 30_000 }).toBe(-1);

    const { last: project } = await page.evaluate(() =>
      fetch("/api/project/list", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then(
        (r) => r.json() as Promise<{ last: string }>,
      ),
    );
    const before = (await main(app)).progress.length;
    const { jobId } = await page.evaluate(
      (p) =>
        fetch("/api/gen/tests", {
          method: "POST",
          headers: { "content-type": "application/json", "X-Testimus-Project": encodeURIComponent(p) },
          body: JSON.stringify({ request: "Le disjoncteur à distance" }),
        }).then((r) => r.json() as Promise<{ jobId: string }>),
      project,
    );
    expect(jobId).toBeTruthy();
    await expect
      .poll(async () => (await main(app)).progress.slice(before).some((v) => v >= 0 && v <= 1), { timeout: 30_000 })
      .toBe(true);
    await expect.poll(async () => (await main(app)).progress.at(-1), { timeout: 90_000 }).toBe(-1);

    const notes = (await main(app)).notes.map((n) => n.title);
    expect(notes).toContain("Add document finished");
    expect(notes).toContain("Generate tests finished");
    expect(shell.csp).toEqual([]);
  } finally {
    await quit(shell);
  }
});
