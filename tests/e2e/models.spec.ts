import { dirname, join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

async function openModels(page: Page) {
  await boot(page, "#/settings/models");
  const models = page.getByRole("region", { name: "Models", exact: true });
  await expect(models.getByRole("article", { name: "Light pack" })).toBeVisible();
  await top(models.getByRole("heading", { name: "Models", exact: true }));
  return models;
}

async function top(target: Locator) {
  await target.evaluate((e) => e.scrollIntoView({ block: "start" }));
}

async function typeFolder(dialog: Locator, dir: string) {
  const field = dialog.getByRole("textbox", { name: /^Folder/ });
  await expect(field).toHaveValue(/\S/);
  await field.fill(dir);
  await expect(field).toHaveValue(dir);
}

async function sandbox(url: string): Promise<string> {
  return dirname((await api<{ dir: string }>(url, "project.info")).dir);
}

test.describe("default PC: a 16 GB GPU, a models folder", () => {
  const server = mockServer(4360);

  test("the packs say what runs here, and the advice can be applied or dismissed", async ({ page }) => {
    const models = await openModels(page);
    const light = models.getByRole("article", { name: "Light pack" });
    await expect(light).toContainText("In use");
    await expect(light).toContainText("Installed");
    await expect(light).not.toContainText("Not in use");
    const quality = models.getByRole("article", { name: "Quality pack" });
    await expect(quality).toContainText("Qwen3 Embedding 8B (4-bit) + Qwen3 Reranker 4B (8-bit, GGUF) · GPU");
    const said = quality.getByRole("list", { name: "On this PC" });
    await expect(said).toContainText("Chosen here: the first variant that fits (16.0 GB GPU).");
    await expect(said).not.toContainText("not chosen");
    await expect(quality).toContainText("Partly installed");
    await expect(models.getByRole("article", { name: "Custom pack" })).toBeVisible();
    const advice = models.getByRole("region", { name: "Advice" });
    await expect(advice).toContainText("Performance pack");
    await expect(advice).toContainText("under 20 %");
    await shoot(page, "models-packs-e2e");

    await advice.getByRole("button", { name: "Apply" }).click();
    const plan = page.getByRole("dialog", { name: "Download the Performance pack" });
    await expect(plan).toContainText("Qwen3 Embedding 0.6B (16-bit, DirectML)");
    await plan.getByRole("button", { name: "Cancel" }).click();
    await expect(plan).toBeHidden();

    await advice.getByRole("button", { name: "Dismiss" }).click();
    await expect(models.getByRole("region", { name: "Advice" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("article", { name: "Light pack" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Advice" })).toHaveCount(0);
  });

  test("Use this pack shows the plan, downloads in a job, then Use takes over", async ({ page }) => {
    const models = await openModels(page);
    await models
      .getByRole("article", { name: "Performance pack" })
      .getByRole("button", { name: "Use this pack" })
      .click();
    const plan = page.getByRole("dialog", { name: "Download the Performance pack" });
    await expect(plan).toContainText("Qwen3 Embedding 0.6B (16-bit, DirectML)");
    await expect(plan).toContainText(join(await sandbox(server.url), "models"));
    await shoot(page, "models-plan-e2e");
    await plan.getByRole("button", { name: /^Download \S+ [MG]B$/ }).click();
    await expect(plan).toBeHidden();
    const card = models.getByRole("article", { name: "Performance pack" });
    await expect(card.getByRole("status", { name: "Downloading Performance" })).toBeVisible();
    await expect(
      models.getByRole("article", { name: "Balanced pack" }).getByRole("button", { name: "Use this pack" }),
    ).toBeEnabled();
    await shoot(page, "models-download-e2e");
    await expect(card).toContainText("Installed", { timeout: 30_000 });
    await expect(card).not.toContainText("In use");
    await card.getByRole("button", { name: "Use this pack" }).click();
    await page
      .getByRole("dialog", { name: "Use the Performance pack" })
      .getByRole("button", { name: "Use Performance" })
      .click();
    await expect(card).toContainText("In use", { timeout: 30_000 });
    await expect(card.getByRole("list", { name: "On this PC" })).not.toContainText("not chosen");
    const light = models.getByRole("article", { name: "Light pack" });
    await expect(light).not.toContainText("In use");
    await expect(light).toContainText("Not in use");
    await expect(light).toContainText("Installed, not in use: the Performance pack does not need it.");
  });

  test("the model table is folded, then lists the catalog with what is on this PC", async ({ page }) => {
    const models = await openModels(page);
    const fold = models.getByRole("button", { name: "Model catalog" });
    await expect(fold).toHaveAttribute("aria-expanded", "false");
    await expect(models.getByRole("table", { name: "Model catalog" })).toHaveCount(0);
    await fold.click();
    const table = models.getByRole("table", { name: "Model catalog" });
    await expect(table.getByRole("row", { name: "BGE-M3 (8-bit, CPU)" })).toContainText("Verify");
    await expect(table.getByRole("row", { name: "Qwen3 Reranker 4B (8-bit, GGUF)" })).toContainText("Install");
    await top(table.getByRole("row", { name: "BGE-M3 (8-bit, CPU)" }));
    await shoot(page, "models-table-e2e");
    const row = table.getByRole("row", { name: "Qwen3 Reranker 4B (8-bit, GGUF)" });
    await row.getByRole("button", { name: "Install" }).click();
    const plan = page.getByRole("alertdialog", { name: "Download Qwen3 Reranker 4B (8-bit, GGUF)?" });
    await expect(plan).toContainText("to download");
    await plan.getByRole("button", { name: /^Download / }).click();
    await expect(row.getByRole("button", { name: "Verify" })).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe("a 4 GB GPU", () => {
  mockServer(4361, { TESTIMUS_MOCK_MACHINE: "gpu-small" });

  test("a pack that runs partly on the processor asks first, and offers a lighter one", async ({ page }) => {
    const models = await openModels(page);
    const quality = models.getByRole("article", { name: "Quality pack" });
    await expect(quality).toContainText("Partly on the processor");
    await expect(quality.getByRole("list", { name: "On this PC" })).toContainText(
      "not chosen: needs 11.4 GB of GPU memory, this PC has 4.0 GB.",
    );
    const balancedCard = models.getByRole("article", { name: "Balanced pack" });
    const balancedSaid = balancedCard.getByRole("list", { name: "On this PC" });
    await expect(balancedSaid).toContainText("Chosen here: the first variant that fits (on the processor");
    await expect(balancedSaid).toContainText("not chosen: needs 6.1 GB of GPU memory, this PC has 4.0 GB.");
    await quality.getByRole("button", { name: "Use this pack" }).click();
    const ask = page.getByRole("dialog", { name: "Use the Quality pack anyway?" });
    await expect(ask).toContainText("Partly on the processor");
    await expect(ask).toContainText("Your GPU has 4.0 GB");
    await shoot(page, "models-fit-gpu-e2e");
    await ask.getByRole("button", { name: "Choose a lighter one" }).click();
    // Balanced would run on the processor here (its two 0.6B GGUF take 3.6 GB): the lighter one offered is Performance
    const lighter = page.getByRole("dialog", { name: /^(Use|Download) the Performance pack$/ });
    await expect(lighter).toContainText("Qwen3 Embedding 0.6B (16-bit, DirectML)");
    await lighter.getByRole("button", { name: "Cancel" }).click();
    await expect(lighter).toBeHidden();
    await quality.getByRole("button", { name: "Use this pack" }).click();
    await ask.getByRole("button", { name: "Use anyway" }).click();
    await expect(page.getByRole("dialog", { name: "Download the Quality pack" })).toBeVisible();
  });
});

test.describe("no GPU and 6 GB of memory", () => {
  mockServer(4362, { TESTIMUS_MOCK_MACHINE: "cpu-only" });

  test("variants too big for the memory are left aside with the numbers, and a model too big is refused", async ({
    page,
  }) => {
    const models = await openModels(page);
    const quality = models.getByRole("article", { name: "Quality pack" });
    const said = quality.getByRole("list", { name: "On this PC" });
    await expect(said).toContainText("Chosen here: no variant fits comfortably, this one runs with the least trouble.");
    await expect(quality).toContainText("Tight");
    await expect(said).toContainText("of memory, this PC has 6.0 GB.");
    await models.getByRole("button", { name: "Model catalog" }).click();
    const table = models.getByRole("table", { name: "Model catalog" });
    await table
      .getByRole("row", { name: "Qwen3 Embedding 8B (4-bit)" })
      .getByRole("button", { name: "Use", exact: true })
      .click();
    const ask = page.getByRole("dialog", { name: /^Qwen3 Embedding 8B .* cannot run on this PC$/ });
    await expect(ask).toContainText("RAM too small");
    await expect(ask.getByRole("button", { name: "Use anyway" })).toHaveCount(0);
    await shoot(page, "models-fit-ram-e2e");
    await ask.getByRole("button", { name: "Cancel" }).click();
  });
});

test.describe("first download, no models folder chosen", () => {
  const server = mockServer(4363, { TESTIMUS_MOCK_MODELS_DIR: "unset", TESTIMUS_MOCK_LLAMACPP: "absent" });

  test("the first download asks where models go, then Change… moves them", async ({ page }) => {
    const root = await sandbox(server.url);
    const models = await openModels(page);
    await expect(models).toContainText("Not chosen yet — Testimus asks on the first download.");
    await models
      .getByRole("article", { name: "Performance pack" })
      .getByRole("button", { name: "Use this pack" })
      .click();
    const where = page.getByRole("dialog", { name: "Where should models be stored?" });
    await typeFolder(where, join(root, "first-models"));
    await expect(where.getByRole("status")).toContainText("free on");
    await shoot(page, "models-folder-first-e2e");
    await where.getByRole("button", { name: "Store models here" }).click();
    const plan = page.getByRole("dialog", { name: "Download the Performance pack" });
    await expect(plan).toContainText(join(root, "first-models"));
    await plan.getByRole("button", { name: /^Download \S+ [MG]B$/ }).click();
    const card = models.getByRole("article", { name: "Performance pack" });
    await expect(card).toContainText("Installed", { timeout: 30_000 });
    await card.getByRole("button", { name: "Use this pack" }).click();
    await page
      .getByRole("dialog", { name: "Use the Performance pack" })
      .getByRole("button", { name: "Use Performance" })
      .click();
    await expect(card).toContainText("In use", { timeout: 30_000 });

    await models.getByRole("button", { name: "Change…" }).first().click();
    const change = page.getByRole("dialog", { name: "Change the models folder" });
    const moved = join(root, "moved-models");
    await typeFolder(change, moved);
    const how = change.getByRole("radiogroup", { name: "The models already downloaded" });
    await how.getByRole("radio", { name: /^Keep them where they are/ }).click();
    await expect(change).toContainText("They stay where they are");
    await how.getByRole("radio", { name: /^Copy/ }).click();
    await how.getByRole("radio", { name: /^Move/ }).click();
    await expect(change).toContainText(/Moving .* is followed as a job in Jobs\./);
    await expect(change.getByRole("button", { name: "Use this folder" })).toBeEnabled();
    await shoot(page, "models-folder-change-e2e");
    await change.getByRole("button", { name: "Use this folder" }).click();
    await expect(change).toBeHidden();
    await expect(models).toContainText(moved, { timeout: 30_000 });
    await expect
      .poll(async () =>
        (await api<{ where: string }[]>(server.url, "models.list")).some((m) => m.where.startsWith(moved)),
      )
      .toBe(true);
  });
});
