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
  const field = dialog.getByRole("textbox", { name: "Folder" });
  await expect(field).toHaveValue(/\S/);
  await field.fill(dir);
  await expect(field).toHaveValue(dir);
}

async function sandbox(url: string): Promise<string> {
  return dirname((await api<{ dir: string }>(url, "project.info")).dir);
}

test.describe("default PC: a 16 GB GPU, no Ollama, a models folder", () => {
  const { url } = mockServer(4360);

  test("the packs say what runs here, and the advice can be applied or dismissed", async ({ page }) => {
    const models = await openModels(page);
    const light = models.getByRole("article", { name: "Light pack" });
    await expect(light).toContainText("In use");
    await expect(light).toContainText("Nothing left");
    const quality = models.getByRole("article", { name: "Quality pack" });
    await expect(quality).toContainText("second choice");
    await expect(quality.getByRole("list", { name: "Skipped variants" })).toContainText("tight");
    await expect(models.getByRole("article", { name: "Custom pack" })).toBeVisible();
    const advice = models.getByRole("region", { name: "Advice" });
    await expect(advice).toContainText("Performance pack");
    await expect(advice).toContainText("under 20 %");
    await shoot(page, "models-packs-e2e");

    await advice.getByRole("button", { name: "Apply" }).click();
    const plan = page.getByRole("dialog", { name: "Use the Performance pack" });
    await expect(plan).toContainText("Qwen3 Embedding 0.6B (16-bit, DirectML)");
    await plan.getByRole("button", { name: "Cancel" }).click();
    await expect(plan).toBeHidden();

    await advice.getByRole("button", { name: "Dismiss" }).click();
    await expect(models.getByRole("region", { name: "Advice" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("article", { name: "Light pack" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Advice" })).toHaveCount(0);
  });

  test("Use this pack shows the plan, then downloads in a job and takes over", async ({ page }) => {
    const models = await openModels(page);
    await models.getByRole("button", { name: "Use the Performance pack" }).click();
    const plan = page.getByRole("dialog", { name: "Use the Performance pack" });
    await expect(plan).toContainText("Qwen3 Embedding 0.6B (16-bit, DirectML)");
    await expect(plan).toContainText(join(await sandbox(url), "models"));
    await shoot(page, "models-plan-e2e");
    await plan.getByRole("button", { name: /^Download .* and use$/ }).click();
    await expect(plan).toBeHidden();
    const card = models.getByRole("article", { name: "Performance pack" });
    await expect(card.getByRole("status", { name: "Installing Performance" })).toBeVisible();
    await shoot(page, "models-download-e2e");
    await expect(card).toContainText("In use", { timeout: 30_000 });
    await expect(models.getByRole("article", { name: "Light pack" })).not.toContainText("In use");
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
    await table.getByRole("button", { name: "Install Qwen3 Reranker 4B (8-bit, GGUF)" }).click();
    const row = table.getByRole("row", { name: "Qwen3 Reranker 4B (8-bit, GGUF)" });
    await expect(row.getByRole("button", { name: "Verify Qwen3 Reranker 4B (8-bit, GGUF)" })).toBeVisible({
      timeout: 30_000,
    });
  });

  test("Ollama is optional and says it is not installed", async ({ page }) => {
    const models = await openModels(page);
    const ollama = models.getByRole("region", { name: "Ollama" });
    await expect(ollama).toContainText("Not installed");
    await expect(ollama).toContainText("It is optional");
  });
});

test.describe("a 4 GB GPU", () => {
  mockServer(4361, { TESTIMUS_MOCK_MACHINE: "gpu-small" });

  test("a pack that runs partly on the processor asks first, and offers a lighter one", async ({ page }) => {
    const models = await openModels(page);
    const quality = models.getByRole("article", { name: "Quality pack" });
    await expect(quality).toContainText("Partly on the CPU");
    await quality.getByRole("button", { name: "Use the Quality pack" }).click();
    const ask = page.getByRole("dialog", { name: "Will The Quality pack fit?" });
    await expect(ask).toContainText("may not fit this PC");
    await expect(ask).toContainText("Your GPU has 4.0 GB");
    await shoot(page, "models-fit-gpu-e2e");
    await ask.getByRole("button", { name: "Choose a lighter one" }).click();
    const balanced = page.getByRole("dialog", { name: "Will The Balanced pack fit?" });
    await expect(balanced).toContainText("Tight");
    await balanced.getByRole("button", { name: "Use anyway" }).click();
    await expect(page.getByRole("dialog", { name: "Use the Balanced pack" })).toBeVisible();
  });
});

test.describe("no GPU and 6 GB of memory", () => {
  mockServer(4362, { TESTIMUS_MOCK_MACHINE: "cpu-only" });

  test("a pack too big for the memory is not offered, and a model too big is refused", async ({ page }) => {
    const models = await openModels(page);
    const quality = models.getByRole("article", { name: "Quality pack" });
    await expect(quality).toContainText("Not available on this PC");
    await expect(quality.getByRole("button", { name: "Use the Quality pack" })).toBeDisabled();
    await expect(quality.getByRole("list", { name: "Skipped variants" })).toContainText("ram-too-small");
    await models.getByRole("button", { name: "Model catalog" }).click();
    const table = models.getByRole("table", { name: "Model catalog" });
    await table.getByRole("button", { name: "Use Qwen3 Embedding 8B (4-bit) for this project" }).click();
    const ask = page.getByRole("dialog", { name: /^Will Qwen3 Embedding 8B .* fit\?$/ });
    await expect(ask).toContainText("cannot run on this PC");
    await expect(ask.getByRole("button", { name: "Use anyway" })).toHaveCount(0);
    await shoot(page, "models-fit-ram-e2e");
    await ask.getByRole("button", { name: "Cancel" }).click();
  });
});

test.describe("first download, no models folder chosen", () => {
  const { url } = mockServer(4363, { TESTIMUS_MOCK_MODELS_DIR: "unset", TESTIMUS_MOCK_LLAMACPP: "absent" });

  test("the first download asks where models go, then Change… moves them", async ({ page }) => {
    const root = await sandbox(url);
    const models = await openModels(page);
    await expect(models).toContainText("not chosen yet");
    await models.getByRole("button", { name: "Use the Performance pack" }).click();
    const where = page.getByRole("dialog", { name: "Models folder" });
    await expect(where).toContainText("Where should models be stored?");
    await typeFolder(where, join(root, "first-models"));
    await expect(where.getByRole("status")).toContainText("free on");
    await shoot(page, "models-folder-first-e2e");
    await where.getByRole("button", { name: "Store models here" }).click();
    const plan = page.getByRole("dialog", { name: "Use the Performance pack" });
    await expect(plan).toContainText(join(root, "first-models"));
    await plan.getByRole("button", { name: /^Download .* and use$/ }).click();
    await expect(models.getByRole("article", { name: "Performance pack" })).toContainText("In use", {
      timeout: 30_000,
    });

    await models.getByRole("button", { name: "Change…" }).first().click();
    const change = page.getByRole("dialog", { name: "Models folder" });
    await expect(change).toContainText("Change the models folder");
    const moved = join(root, "moved-models");
    await typeFolder(change, moved);
    const seg = change.getByRole("group", { name: "The models already downloaded" });
    await seg.getByRole("button", { name: "Keep where they are" }).click();
    await expect(change).toContainText("They stay where they are");
    await seg.getByRole("button", { name: "Copy" }).click();
    await seg.getByRole("button", { name: "Move" }).click();
    await expect(change.getByRole("button", { name: /^Move \d/ })).toBeEnabled();
    await shoot(page, "models-folder-change-e2e");
    await change.getByRole("button", { name: /^Move \d/ }).click();
    await expect(change).toBeHidden();
    await expect(models).toContainText(moved, { timeout: 30_000 });
    await expect
      .poll(async () => (await api<{ where: string }[]>(url, "models.list")).some((m) => m.where.startsWith(moved)))
      .toBe(true);
  });
});

test.describe("Ollama installed", () => {
  test.describe("but stopped", () => {
    mockServer(4365, { TESTIMUS_MOCK_OLLAMA: "stopped" });
    test("the panel says to start it", async ({ page }) => {
      const ollama = (await openModels(page)).getByRole("region", { name: "Ollama" });
      await expect(ollama).toContainText("Installed, not running");
      await expect(ollama).toContainText("Start Ollama, then Refresh");
    });
  });

  test.describe("and running", () => {
    mockServer(4364, { TESTIMUS_MOCK_OLLAMA: "running" });
    test("the panel lists its embedding models and the one partly on the processor", async ({ page }) => {
      const ollama = (await openModels(page)).getByRole("region", { name: "Ollama" });
      await expect(ollama).toContainText("Running 0.12.6");
      await expect(ollama).toContainText("qwen3-embedding:0.6b");
      await expect(ollama).toContainText("qwen3-embedding:4b");
      await expect(ollama).not.toContainText("llama3.2");
      await expect(ollama).toContainText("partly on the processor (2.8 GB on the GPU)");
      await top(ollama);
      await shoot(page, "models-ollama-e2e");
    });
  });
});
