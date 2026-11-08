import { dirname, join } from "node:path";
import { api, expect, mockServer, shoot, test } from "./helpers.ts";

type Pack = { id: string; active: boolean };

test.describe("a 16 GB GPU, no pack chosen on this PC yet", () => {
  const server = mockServer(4370, { TESTIMUS_MOCK_ADVICE: "none" });

  test("the project step leads to the pack step, which suggests the heaviest pack that fits", async ({ page }) => {
    await page.goto("/#/setup/project");
    const steps = page.getByRole("list", { name: "Setup steps" });
    await steps.getByRole("button", { name: /Search/ }).click();
    await expect(page).toHaveURL(/#\/setup\/pack$/);
    await expect(page.getByRole("heading", { level: 1, name: "How should documents be searched?" })).toBeVisible();
    const packs = page.getByRole("radiogroup", { name: "Search packs" });
    const quality = packs.getByRole("radio", { name: /^Quality\b/ });
    await expect(quality).toBeEnabled();
    await expect(quality).toBeChecked();
    await expect(packs.locator("label").filter({ has: page.getByRole("radio", { name: /^Quality\b/ }) })).toContainText(
      "Suggested for this PC",
    );
    await expect(packs.getByRole("radio", { name: /^Light\b/ })).toBeEnabled();
    await shoot(page, "setup-pack-e2e");

    await page.getByRole("button", { name: "Use Quality" }).click();
    const plan = page.getByRole("dialog", { name: /^(Download and use|Use) the Quality pack$/ });
    await plan.getByRole("button", { name: /^(Download |Use Quality)/ }).click();
    await expect(page).toHaveURL(/#\/setup\/ready$/);
    await expect(page.getByRole("list", { name: "Setup summary" })).toContainText("Search");
    await expect
      .poll(async () => (await api<Pack[]>(server.url, "models.packs")).find((p) => p.id === "quality")?.active, {
        timeout: 30_000,
      })
      .toBe(true);
  });

  test("Keep … for now leaves the choice as it is", async ({ page }) => {
    await page.goto("/#/setup/pack");
    await page.getByRole("radio", { name: /^Light\b/ }).check();
    await page.getByRole("button", { name: /for now$/ }).click();
    await expect(page).toHaveURL(/#\/setup\/ready$/);
  });
});

test.describe("a 16 GB GPU, Light chosen on this PC", () => {
  mockServer(4372);

  test("the pack this PC chose stays picked; the heavier one is only suggested", async ({ page }) => {
    await page.goto("/#/setup/pack");
    const packs = page.getByRole("radiogroup", { name: "Search packs" });
    const card = (name: string) =>
      packs.locator("label").filter({ has: page.getByRole("radio", { name: new RegExp(`^${name}\\b`) }) });
    await expect(card("Quality")).toContainText("Suggested for this PC");
    await expect(packs.getByRole("radio", { name: /^Light\b/ })).toBeChecked();
    await expect(packs.getByRole("radio", { name: /^Quality\b/ })).not.toBeChecked();
    await expect(card("Light")).toContainText("In use");
    await expect(page.getByRole("button", { name: "Use Light" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Keep Light for now" })).toBeVisible();
  });
});

test.describe("no GPU, 6 GB, no models folder yet", () => {
  const server = mockServer(4371, { TESTIMUS_MOCK_MACHINE: "cpu-only", TESTIMUS_MOCK_MODELS_DIR: "unset" });

  test("the suggestion avoids a model on the processor, and the first download asks for a folder", async ({ page }) => {
    const root = dirname((await api<{ dir: string }>(server.url, "project.info")).dir);
    await page.goto("/#/setup/pack");
    const packs = page.getByRole("radiogroup", { name: "Search packs" });
    await expect(packs.getByRole("radio", { name: /^Light\b/ })).toBeEnabled();
    await expect(packs.getByRole("radio", { name: /^Light\b/ })).toBeChecked();
    await expect(packs.getByRole("radio", { name: /^Quality\b/ })).toBeEnabled();
    for (const heavier of ["Quality", "Performance"])
      await expect(
        packs.locator("label").filter({ has: page.getByRole("radio", { name: new RegExp(`^${heavier}\\b`) }) }),
      ).not.toContainText("Suggested for this PC");
    await expect(
      packs.locator("label").filter({ has: page.getByRole("radio", { name: /^Performance\b/ }) }),
    ).toContainText("Processor only");
    await packs.getByRole("radio", { name: /^Performance\b/ }).check();
    await page.getByRole("button", { name: "Use Performance" }).click();
    const fit = page.getByRole("dialog", { name: "Use the Performance pack on the processor?" });
    await fit.getByRole("button", { name: "Use anyway" }).click();
    const where = page.getByRole("dialog", { name: "Where should models be stored?" });
    await expect(where).toBeVisible();
    const field = where.getByRole("textbox", { name: "Folder" });
    await expect(field).toHaveValue(/\S/);
    await field.fill(join(root, "setup-models"));
    await expect(field).toHaveValue(join(root, "setup-models"));
    await expect(where.getByRole("status")).toContainText("free on");
    await shoot(page, "setup-pack-folder-e2e");
    await where.getByRole("button", { name: "Store models here" }).click();
    const plan = page.getByRole("dialog", { name: "Download and use the Performance pack" });
    await plan.getByRole("button", { name: /^Download / }).click();
    await expect(page).toHaveURL(/#\/setup\/ready$/);
    await expect
      .poll(async () => (await api<Pack[]>(server.url, "models.packs")).find((p) => p.id === "performance")?.active, {
        timeout: 30_000,
      })
      .toBe(true);
  });
});
