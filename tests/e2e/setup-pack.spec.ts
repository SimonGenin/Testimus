import { dirname, join } from "node:path";
import { api, expect, mockServer, shoot, test } from "./helpers.ts";

type Pack = { id: string; active: boolean };

test.describe("a 16 GB GPU", () => {
  const { url } = mockServer(4370);

  test("the project step leads to the pack step, which suggests the heaviest pack that fits", async ({ page }) => {
    await page.goto("/#/setup/project");
    const steps = page.getByRole("list", { name: "Setup steps" });
    await steps.getByRole("button", { name: /Search pack/ }).click();
    await expect(page).toHaveURL(/#\/setup\/pack$/);
    await expect(page.getByRole("heading", { level: 1, name: "Choose how documents are searched" })).toBeVisible();
    const packs = page.getByRole("radiogroup", { name: "Search packs" });
    const quality = packs.getByRole("radio", { name: /^Quality\b/ });
    await expect(quality).toBeEnabled();
    await page.getByRole("button", { name: "Analyse my machine" }).click();
    await expect(quality).toBeChecked();
    await expect(packs.locator("label").filter({ has: page.getByRole("radio", { name: /^Quality\b/ }) })).toContainText(
      "Suggested for this PC",
    );
    await expect(packs.getByRole("radio", { name: /^Light\b/ })).toBeEnabled();
    await shoot(page, "setup-pack-e2e");

    await page.getByRole("button", { name: "Use Quality" }).click();
    await expect(page).toHaveURL(/#\/documents/);
    await expect
      .poll(async () => (await api<Pack[]>(url, "models.packs")).find((p) => p.id === "quality")?.active, {
        timeout: 30_000,
      })
      .toBe(true);
  });

  test("Skip for now leaves the choice as it is", async ({ page }) => {
    await page.goto("/#/setup/pack");
    await page.getByRole("radio", { name: /^Light\b/ }).check();
    await page.getByRole("button", { name: "Skip for now" }).click();
    await expect(page).toHaveURL(/#\/documents/);
  });
});

test.describe("no GPU, 6 GB, no models folder yet", () => {
  const { url } = mockServer(4371, { TESTIMUS_MOCK_MACHINE: "cpu-only", TESTIMUS_MOCK_MODELS_DIR: "unset" });

  test("the suggestion avoids a model on the processor, and the first download asks for a folder", async ({ page }) => {
    const root = dirname((await api<{ dir: string }>(url, "project.info")).dir);
    await page.goto("/#/setup/pack");
    const packs = page.getByRole("radiogroup", { name: "Search packs" });
    await expect(packs.getByRole("radio", { name: /^Light\b/ })).toBeEnabled();
    await page.getByRole("button", { name: "Analyse my machine" }).click();
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
    const where = page.getByRole("dialog", { name: "Models folder" });
    await expect(where).toContainText("Where should models be stored?");
    const field = where.getByRole("textbox", { name: "Folder" });
    await expect(field).toHaveValue(/\S/);
    await field.fill(join(root, "setup-models"));
    await expect(field).toHaveValue(join(root, "setup-models"));
    await expect(where.getByRole("status")).toContainText("free on");
    await shoot(page, "setup-pack-folder-e2e");
    await where.getByRole("button", { name: "Store models here" }).click();
    await expect(page).toHaveURL(/#\/documents/);
    await expect
      .poll(async () => (await api<Pack[]>(url, "models.packs")).find((p) => p.id === "performance")?.active, {
        timeout: 30_000,
      })
      .toBe(true);
  });
});
