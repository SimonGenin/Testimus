import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { api, boot, expect, mockServer, SCREENS_DIR, shoot, test } from "./helpers.ts";

const { url } = mockServer(4444);

const RUN = "recette-j5-sectionneurs";
let base = "";
let child: ChildProcess | null = null;

test.beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "testimus-e2e-pages-"));
});
test.afterAll(() => {
  child?.kill();
  rmSync(base, { recursive: true, force: true });
});

// ponytail: the pages' own server, started as start.cmd does (node serve.mjs), on a free port of 127.0.0.1
function serve(dir: string): Promise<string> {
  child = spawn(process.execPath, [join(dir, "serve.mjs"), "--port", "0", "--no-open"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  return new Promise((ok, fail) => {
    let text = "";
    child?.stdout?.on("data", (b) => {
      text += String(b);
      const m = /READY (http:\/\/127\.0\.0\.1:\d+\/)/.exec(text);
      if (m) ok(m[1]);
    });
    child?.once("exit", (code) => fail(new Error(`serve.mjs exited ${code}`)));
  });
}

test("a run exported as pages is played in the browser on its own server, then its results come back into the Run screen", async ({
  page,
}) => {
  const dir = join(base, "recette-j5");
  await boot(page, `#/run/${RUN}`);
  const run = page.getByRole("region", { name: "Run Recette J5 — Sectionneurs" });
  await run.getByRole("button", { name: "Export as pages…" }).click();
  const exp = page.getByRole("dialog", { name: "Export « Recette J5 — Sectionneurs » as pages" });
  await exp.getByRole("textbox", { name: "Folder" }).fill(dir);
  await shoot(page, "run/run-export");
  await exp.getByRole("button", { name: "Export" }).click();
  await expect(exp).toContainText("The run is in");
  await exp.getByRole("button", { name: "Done" }).click();

  const pages = await serve(dir);
  const sheet = await page.context().newPage();
  await sheet.goto(pages);
  await expect(sheet.getByRole("heading", { level: 1 })).toHaveText("Recette J5 — Sectionneurs");
  await expect(sheet.getByRole("status")).toContainText("Each change is saved in this folder");
  await sheet.getByRole("textbox", { name: "Tester" }).fill("Paul Martin");
  await sheet.getByRole("textbox", { name: "Tester" }).blur();
  await sheet
    .getByRole("navigation", { name: "Tests" })
    .getByRole("button", { name: /Disjoncteur/ })
    .click();
  await sheet.getByRole("group", { name: "Step 1" }).getByRole("button", { name: "NOK" }).click();
  await expect(sheet.getByRole("status")).toContainText("Saved in this folder");
  await sheet.getByRole("textbox", { name: "Comment on step 1" }).fill("Le disjoncteur reste fermé.");
  await sheet.getByRole("textbox", { name: "Comment on step 1" }).blur();
  await sheet.getByRole("textbox", { name: "Add a comment or a question" }).fill("Faut-il un second essai ?");
  await sheet.getByRole("button", { name: "Ask a question" }).click();
  await expect(sheet.getByText("Faut-il un second essai ?", { exact: true })).toBeVisible();
  await expect(
    sheet.getByRole("radiogroup", { name: "Result of the test" }).getByRole("radio", { name: /Problem/ }),
  ).toHaveAttribute("aria-checked", "true");
  await sheet.screenshot({ path: join(SCREENS_DIR, "run", "run-pages-sheet-light.png") });
  await sheet.close();

  await page.getByRole("button", { name: "Import results…" }).click();
  const imp = page.getByRole("dialog", { name: "Import the results" });
  await imp.getByRole("textbox", { name: "Folder or run.json" }).fill(dir);
  await expect(imp).toContainText("Into « Recette J5 — Sectionneurs »: 1 test with a new result · 1 question");
  await shoot(page, "run/run-import");
  await imp.getByRole("button", { name: "Import 1 result" }).click();
  await expect(imp).toBeHidden();
  const row = run.getByRole("row", { name: /Disjoncteur/ });
  await expect(row).toContainText("Problem");
  await expect(row).toContainText("0 OK · 1 NOK");
  await expect(row).toContainText("1 question");
  await expect(row).toContainText("PM");

  const shown = await api<{ tests: { id: string; result: { steps: { note?: string }[] } }[] }>(url, "runs.show", {
    run: RUN,
  });
  expect(shown.tests.find((t) => t.id === "LFRPS12-1398")?.result.steps[0].note).toBe("Le disjoncteur reste fermé.");
});

test("without Node the page keeps the results in the browser and saves a run.json the app imports", async ({
  page,
}) => {
  const dir = join(base, "no-node");
  await api(url, "runs.export", { run: RUN, dir, results: false });
  const sheet = await page.context().newPage();
  await sheet.goto(pathToFileURL(join(dir, "index.html")).href);
  await expect(sheet.getByRole("note")).toContainText("No local server");
  await expect(sheet.getByText("null", { exact: true })).toHaveCount(0);
  await sheet.getByRole("group", { name: "Step 1" }).getByRole("button", { name: "OK", exact: true }).click();
  await expect(sheet.getByRole("status")).toContainText("Kept in this browser");
  const download = sheet.waitForEvent("download");
  await sheet.getByRole("button", { name: "Save run.json" }).click();
  const saved = join(base, "saved-run.json");
  await (await download).saveAs(saved);
  await sheet.close();

  await boot(page, `#/run/${RUN}`);
  await page.getByRole("button", { name: "Import results…" }).click();
  const imp = page.getByRole("dialog", { name: "Import the results" });
  await imp.getByRole("textbox", { name: "Folder or run.json" }).fill(saved);
  await expect(imp).toContainText("1 test with a new result");
  await imp.getByRole("button", { name: /^Import/ }).click();
  await expect(imp).toBeHidden();
  const shown = await api<{ tests: { id: string; result: { steps: { ok: boolean | null }[] } }[] }>(url, "runs.show", {
    run: RUN,
  });
  expect(shown.tests[0].result.steps[0].ok).toBe(true);
});
