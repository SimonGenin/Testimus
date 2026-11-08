import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Browser, chromium, type Page } from "@playwright/test";
import { SCENARIOS, type Scenario, type Server, type Shot } from "./screens-catalog.ts";

const ROOT = join(import.meta.dirname, "..");

// ponytail: the widths cross the UI's breakpoints — lg: everything side by side; md (1366): the documents list becomes
// a drawer below 1464; sm (1024): the Review queue folds to its strip, the document's side panel to a drawer; xs (not
// by default, a half screen): the tests list becomes a drawer below 900, the screens stack to one column below 760
export const SIZES = {
  lg: { width: 1920, height: 1080, label: "Large screen (1920 × 1080)" },
  md: { width: 1366, height: 768, label: "Medium screen (1366 × 768)" },
  sm: { width: 1024, height: 768, label: "Small screen (1024 × 768)" },
  xs: { width: 740, height: 800, label: "Half a screen (740 × 800)" },
} as const;
type Size = keyof typeof SIZES;
type Theme = "light" | "dark";

// ponytail: the area is the part of the UI a shot belongs to (the redesign works area by area: design/screens/<area>/)
const AREAS = ["documents", "generate", "tests", "review", "jobs", "settings", "setup", "doctor"];
const CLAUDE = ["dock", "contexts"];
const SHELL = ["palette", "toast", "project", "command", "open", "activity"];

export function areaOf(scenario: string, shot: string): string {
  if (scenario === "desktop") return "desktop";
  const [first, second] = shot.split("-");
  const word = first === "loading" || first === "error" ? second : first;
  if (word === "models") return "settings";
  if (CLAUDE.includes(word)) return "claude";
  if (SHELL.includes(word)) return "shell";
  return AREAS.includes(word) ? word : "shell";
}

const HELP = `node scripts/screens.ts [options]   — screenshots of every screen, empty and with data, for the design work

  --out <dir>          where the images go (default dist/screens; emptied first)
  --sizes lg,md,sm     viewports (lg 1920×1080, md 1366×768, sm 1024×768; xs 740×800 on demand)
  --themes light,dark  themes
  --only <text>        only the scenarios or shots whose id contains one of these (comma-separated)
  --essai <dir>        the real project copied into the "essai" scenarios (default ~/Testimus/Projects/Essai)
  --jobs <n>           scenarios run at the same time (default 3)
  --no-build           do not run vite build first (dist/ui must be current)
  --headed             show the browser
  --list               print the catalog and stop

Jira and Claude are always fake (serve --mock); a real project is copied into the sandbox, never written.`;

const { values } = parseArgs({
  options: {
    out: { type: "string" },
    sizes: { type: "string" },
    themes: { type: "string" },
    only: { type: "string" },
    essai: { type: "string" },
    jobs: { type: "string" },
    "no-build": { type: "boolean" },
    headed: { type: "boolean" },
    list: { type: "boolean" },
    help: { type: "boolean" },
  },
});
if (values.help) {
  process.stdout.write(`${HELP}\n`);
  process.exit(0);
}

const out = values.out ? resolve(values.out) : join(ROOT, "dist", "screens");
const sizes = (values.sizes ?? "lg,md,sm").split(",") as Size[];
const themes = (values.themes ?? "light,dark").split(",") as Theme[];
const only = values.only?.split(",").filter(Boolean) ?? [];
const essai = values.essai ?? join(process.env.HOME ?? process.env.USERPROFILE ?? "", "Testimus", "Projects", "Essai");
const jobs = Math.max(1, Number(values.jobs) || 3);
for (const s of sizes) if (!SIZES[s]) throw new Error(`unknown size ${s} (lg, md, sm, xs)`);

const picked = (id: string) => !only.length || only.some((o) => id.includes(o));
const scenarios = SCENARIOS(essai)
  .map((sc) => ({ ...sc, shots: sc.shots.filter((sh) => picked(sc.id) || picked(`${sc.id}/${sh.id}`)) }))
  .filter((sc) => sc.shots.length);

if (values.list) {
  for (const sc of scenarios) {
    process.stdout.write(`\n${sc.id} — ${sc.note}${sc.skip ? ` (skipped: ${sc.skip})` : ""}\n`);
    for (const sh of sc.shots)
      process.stdout.write(`  ${sh.id.padEnd(34)} ${areaOf(sc.id, sh.id).padEnd(10)} ${sh.note}\n`);
  }
  process.stdout.write(
    `\n${scenarios.reduce((n, s) => n + s.shots.length, 0)} shots × ${sizes.length} sizes × ${themes.length} themes\n`,
  );
  process.exit(0);
}

type Entry = {
  area: string;
  scenario: string;
  shot: string;
  note: string;
  hash: string;
  files: { size: Size; theme: Theme; part: number; file: string }[];
  errors: string[];
  // the console lines the shot causes on purpose (Shot.expectErrors), kept apart from the errors
  expected?: { why: string; lines: string[] };
};
const manifest: Entry[] = [];
const failures: string[] = [];
const skipped: string[] = [];

function log(line: string): void {
  process.stdout.write(`${line}\n`);
}

function startServer(sc: Scenario): Promise<{ server: Server; child: ChildProcess }> {
  const child = spawn(
    process.execPath,
    [join(ROOT, "src", "faces", "cli.ts"), "serve", "--mock", "--port", "0", "--no-open", "--ready-json"],
    { cwd: ROOT, env: { ...process.env, ...sc.env }, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr?.on("data", (d) => {
    stderr += String(d);
  });
  return new Promise((ok, fail) => {
    let buf = "";
    const timer = setTimeout(() => fail(new Error(`${sc.id}: serve --mock did not start\n${stderr}`)), 120_000);
    child.once("exit", (code) => fail(new Error(`${sc.id}: serve --mock exited (${code})\n${stderr}`)));
    child.stdout?.on("data", (d) => {
      buf += String(d);
      const line = buf.split("\n").find((l) => l.includes('"ready"'));
      if (!line) return;
      clearTimeout(timer);
      const url = (JSON.parse(line) as { url: string }).url.replace(/\/$/, "");
      ok({ server: serverFor(url), child });
    });
  });
}

function serverFor(url: string): Server {
  let cookie = "";
  const api = async <T>(name: string, input: unknown = {}): Promise<T> => {
    if (!cookie) cookie = ((await fetch(`${url}/`)).headers.get("set-cookie") ?? "").split(";")[0];
    const [group, verb] = name.split(".");
    const r = await fetch(`${url}/api/${group}/${verb}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify(input),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(`${name} → ${r.status} ${JSON.stringify(body)}`);
    return body as T;
  };
  const waitJob = async (id: string) => {
    const until = Date.now() + 60_000;
    while (Date.now() < until) {
      const { job } = await api<{ job: { status: string } }>("jobs.show", { id });
      if (job.status !== "running" && job.status !== "queued") return;
      await new Promise((r) => setTimeout(r, 200));
    }
  };
  return { url, api, waitJob };
}

// ponytail: a shot is light or dark the way the design draws it — the theme preference stays « System » (the rail says
// so) and the window's colour scheme is light or dark; the storage event is how another window's change reaches the
// page's preference and its <html>
async function applyTheme(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme });
  await page.evaluate(() => {
    try {
      localStorage.removeItem("testimus.theme");
    } catch {}
    window.dispatchEvent(new StorageEvent("storage", { key: "testimus.theme" }));
    window.dispatchEvent(new CustomEvent("testimus:theme", { detail: "system" }));
  });
}

// ponytail: the shell never scrolls the page, its panes do — the tallest overflowing pane is walked a screen at a
// time so a long settings page or test is mapped whole (6 screens at most); with a dialog open, only the dialog is
// walked
async function scrollParts(page: Page): Promise<number> {
  return page.evaluate(() => {
    let best: HTMLElement | null = null;
    let most = 40;
    const scope = [...document.querySelectorAll<HTMLElement>("[role=dialog], dialog[open]")].find(
      (d) => d.offsetParent !== null,
    );
    for (const el of (scope ?? document).querySelectorAll<HTMLElement>("*")) {
      const over = el.scrollHeight - el.clientHeight;
      const style = getComputedStyle(el);
      if (over > most && /(auto|scroll)/.test(style.overflowY) && el.clientHeight > 200) {
        best = el;
        most = over;
      }
    }
    for (const e of document.querySelectorAll("[data-screens-scroll]")) e.removeAttribute("data-screens-scroll");
    if (!best) return 1;
    best.setAttribute("data-screens-scroll", "");
    best.scrollTop = 0;
    return Math.min(6, Math.ceil(best.scrollHeight / (best.clientHeight * 0.9)));
  });
}

async function shootAll(page: Page, sc: Scenario, sh: Shot, dir: string, entry: Entry): Promise<void> {
  for (const size of sizes.filter((z) => !sh.sizes || sh.sizes.includes(z))) {
    await page.setViewportSize({ width: SIZES[size].width, height: SIZES[size].height });
    await page.waitForTimeout(250);
    for (const theme of themes) {
      await applyTheme(page, theme);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(150);
      const parts = sh.scroll === false ? 1 : await scrollParts(page);
      for (let part = 1; part <= parts; part++) {
        if (part > 1)
          await page.evaluate(() => {
            const el = document.querySelector<HTMLElement>("[data-screens-scroll]");
            if (el) el.scrollTop += el.clientHeight * 0.9;
          });
        const name = `${size}-${theme}${parts > 1 ? `-p${part}` : ""}.png`;
        await page.screenshot({ path: join(dir, name), animations: "disabled", caret: "hide" });
        entry.files.push({ size, theme, part, file: relative(out, join(dir, name)).replaceAll("\\", "/") });
      }
      if (parts > 1)
        await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>("[data-screens-scroll]");
          if (el) el.scrollTop = 0;
        });
    }
  }
  log(`  ✓ ${sc.id}/${sh.id} (${entry.files.length} images)`);
}

// ponytail: a shot that fails is taken once more (a slow machine, a page caught mid-reload); a second failure is a loss
async function runShot(browser: Browser, server: Server, sc: Scenario, sh: Shot, again = true): Promise<void> {
  const first = SIZES[sizes[0]];
  const context = await browser.newContext({
    viewport: { width: first.width, height: first.height },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "fr-FR",
  });
  const page = await context.newPage();
  const entry: Entry = {
    area: areaOf(sc.id, sh.id),
    scenario: sc.id,
    shot: sh.id,
    note: sh.note,
    hash: sh.hash ?? "",
    files: [],
    errors: [],
  };
  page.on("pageerror", (e) => entry.errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const want = sh.expectErrors;
    if (!want || !want.pattern.test(m.text())) {
      entry.errors.push(m.text());
      return;
    }
    entry.expected = entry.expected ?? { why: want.why, lines: [] };
    entry.expected.lines.push(m.text());
  });
  // ponytail: a window with no testimus.* key asks the server for its mirrored prefs and may reload mid-shot
  await page.addInitScript((setup) => {
    try {
      if (!localStorage.getItem("testimus.theme")) localStorage.setItem("testimus.theme", "light");
      if (!setup) sessionStorage.setItem("testimus.setupShown", "1");
    } catch {}
  }, sh.setup === true);
  try {
    if (sh.page) await sh.page(page, server);
    else {
      await page.goto(`${server.url}/${sh.hash ?? "#/tests"}`);
      await (sh.ready ? sh.ready(page) : page.getByRole("navigation", { name: "Main" })).waitFor({ timeout: 20_000 });
      await page.waitForLoadState("networkidle").catch(() => {});
      if (sh.prep) await sh.prep(page, server);
      await page.waitForTimeout(sh.settle ?? 400);
    }
    await page.mouse.move(0, 0);
    const dir = join(out, sc.id, sh.id);
    mkdirSync(dir, { recursive: true });
    await shootAll(page, sc, sh, dir, entry);
    manifest.push(entry);
  } catch (e) {
    if (again) {
      log(`  ↻ ${sc.id}/${sh.id}: ${(e as Error).message.split("\n")[0]} — once more`);
      await context.close().catch(() => {});
      return runShot(browser, server, sc, sh, false);
    }
    failures.push(`${sc.id}/${sh.id}: ${(e as Error).message.split("\n")[0]}`);
    log(`  ✗ ${sc.id}/${sh.id}: ${(e as Error).message.split("\n")[0]}`);
    const dir = join(out, "_failed");
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${sc.id}--${sh.id}.png`) }).catch(() => {});
  } finally {
    await context.close();
  }
}

async function runScenario(browser: Browser, sc: Scenario): Promise<void> {
  if (sc.skip) {
    skipped.push(`${sc.id}: ${sc.skip}`);
    log(`– ${sc.id} skipped: ${sc.skip}`);
    return;
  }
  log(`▶ ${sc.id} — ${sc.note}`);
  let child: ChildProcess | null = null;
  try {
    const started = sc.noServer ? { server: serverFor(""), child: null } : await startServer(sc);
    child = started.child;
    if (sc.before) await sc.before(started.server);
    for (const sh of sc.shots) await runShot(browser, started.server, sc, sh);
  } catch (e) {
    failures.push(`${sc.id}: ${(e as Error).message.split("\n")[0]}`);
    log(`✗ ${sc.id}: ${(e as Error).message}`);
  } finally {
    child?.kill();
  }
}

function writeIndex(): void {
  const order = new Map(scenarios.map((s, i) => [s.id, i]));
  manifest.sort((a, b) => (order.get(a.scenario) ?? 0) - (order.get(b.scenario) ?? 0));
  const notes = Object.fromEntries(scenarios.map((s) => [s.id, s.note]));
  writeFileSync(
    join(out, "manifest.json"),
    `${JSON.stringify({ made: new Date().toISOString(), sizes: Object.fromEntries(sizes.map((s) => [s, SIZES[s]])), themes, scenarios: notes, shots: manifest }, null, 2)}\n`,
  );
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  let html = `<!doctype html><meta charset="utf-8"><title>Testimus screens</title><style>body{font:14px system-ui;margin:24px;background:#f4f4f5;color:#18181b}h2{margin-top:40px}h3{margin:24px 0 4px}p{margin:0 0 8px;color:#52525b}.row{display:flex;gap:12px;overflow-x:auto}figure{margin:0}figure img{height:220px;border:1px solid #d4d4d8;background:#fff}figcaption{font-size:12px;color:#71717a}</style><h1>Testimus screens</h1><p>${manifest.length} shots · sizes ${sizes.join(", ")} · themes ${themes.join(", ")}</p>`;
  let current = "";
  for (const e of manifest) {
    if (e.scenario !== current) {
      current = e.scenario;
      html += `<h2>${esc(current)}</h2><p>${esc(notes[current] ?? "")}</p>`;
    }
    html += `<h3>${esc(e.shot)}</h3><p>${esc(e.note)}${e.hash ? ` — <code>${esc(e.hash)}</code>` : ""}</p><div class="row">`;
    for (const f of e.files)
      html += `<figure><a href="${f.file}"><img loading="lazy" src="${f.file}"></a><figcaption>${f.size} · ${f.theme}${f.part > 1 || e.files.some((x) => x.part > 1) ? ` · ${f.part}` : ""}</figcaption></figure>`;
    html += "</div>";
  }
  writeFileSync(join(out, "index.html"), html);
}

if (!values["no-build"]) {
  log("vite build…");
  const b = spawnSync("npx", ["vite", "build"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: !values.headed });
const queue = [...scenarios];
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    for (let sc = queue.shift(); sc; sc = queue.shift()) await runScenario(browser, sc);
  }),
);
await browser.close();
writeIndex();
const images = manifest.reduce((n, e) => n + e.files.length, 0);
log(
  `\n${manifest.length} shots, ${images} images in ${out}${skipped.length ? `\n${skipped.length} skipped:\n  ${skipped.join("\n  ")}` : ""}${failures.length ? `\n${failures.length} failed:\n  ${failures.join("\n  ")}` : ""}`,
);
process.exit(failures.length ? 1 : 0);
