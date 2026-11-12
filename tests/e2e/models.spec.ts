import { dirname, join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

async function openModels(page: Page) {
  await boot(page, "#/settings/models");
  const models = page.getByRole("region", { name: "Models", exact: true });
  await expect(models.getByRole("table", { name: "Embedding models" })).toBeVisible();
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

const group = (models: Locator, name: string) => models.getByRole("region", { name: new RegExp(`^${name}`) });
const row = (models: Locator, table: string, name: string) =>
  models
    .getByRole("table", { name: table })
    .getByRole("row", { name: new RegExp(`^${name.replace(/[()]/g, "\\$&")}`) });

test.describe("default PC: a 16 GB GPU, a models folder", () => {
  mockServer(4360);

  test("each kind: the model advised for this PC first, then every other one, the constraints said", async ({
    page,
  }) => {
    const models = await openModels(page);
    await expect(models.getByRole("article", { name: /pack$/ })).toHaveCount(0);
    const emb = group(models, "Embeddings");
    await expect(emb).toContainText("Advised for this PC");
    await expect(emb).toContainText("Qwen3 Embedding 8B (4-bit)");
    await expect(row(models, "Embedding models", "BGE-M3 (8-bit, CPU)")).toContainText("In use");
    await expect(emb).toContainText("the vectors of a model already used are kept");
    // the 16 GB card does not move BGE-M3 8-bit (no DirectML form): it runs on the processor, in its own process
    await expect(emb).toContainText("Embedding: processor, 22 cores, separate process");

    const rr = group(models, "Reranker");
    await expect(rr).toContainText("Qwen3 Reranker 4B (8-bit, GGUF)");
    await expect(row(models, "Reranker models", "None")).toContainText("In use");
    const cpu = row(models, "Reranker models", "BGE Reranker v2 M3 (8-bit, CPU)");
    await expect(cpu).toContainText("Not offered while the embedding runs on the processor");
    await expect(cpu.getByRole("button", { name: "Use", exact: true })).toBeDisabled();
    await expect(rr).toContainText(/llama\.cpp b\S+/);

    await expect(group(models, "Transcription")).toContainText("Advised for this PC");
    await expect(group(models, "LLM")).toContainText("Soon");
    await shoot(page, "models-e2e");
  });

  test("Use on a model not here: the plan, the download in a job, then it is in use", async ({ page }) => {
    const models = await openModels(page);
    const name = "Qwen3 Embedding 0.6B (16-bit, DirectML)";
    await row(models, "Embedding models", name).getByRole("button", { name: "Use", exact: true }).click();
    const plan = page.getByRole("alertdialog", { name: `Download and use ${name}?` });
    await expect(plan).toContainText("to download first");
    await expect(plan).toContainText("indexed again with it");
    await shoot(page, "models-plan-e2e");
    await plan.getByRole("button", { name: /^Download \S+ [MG]B and use$/ }).click();
    await expect(plan).toBeHidden();
    await expect(
      row(models, "Embedding models", name).getByRole("status", { name: `Downloading ${name}` }),
    ).toBeVisible();
    await shoot(page, "models-download-e2e");
    await expect(row(models, "Embedding models", name)).toContainText("In use", { timeout: 30_000 });
    await expect(row(models, "Embedding models", "BGE-M3 (8-bit, CPU)")).not.toContainText("In use");
    await expect(group(models, "Embeddings")).toContainText("Embedding: graphics card (DirectML), separate process");
  });
});

test.describe("a 4 GB GPU", () => {
  mockServer(4361, { TESTIMUS_MOCK_MACHINE: "gpu-small" });

  test("a reranker that does not fit beside the embedding says why and asks first, offering a lighter one", async ({
    page,
  }) => {
    const models = await openModels(page);
    await expect(group(models, "Embeddings")).toContainText("Qwen3 Embedding 0.6B (16-bit, DirectML)");
    const big = row(models, "Reranker models", "Qwen3 Reranker 4B (8-bit, GGUF)");
    await expect(big).toContainText("partly on the processor");
    await big.getByRole("button", { name: "Use", exact: true }).click();
    const ask = page.getByRole("dialog", { name: "Use Qwen3 Reranker 4B (8-bit, GGUF) anyway?" });
    await expect(ask).toContainText("Partly on the processor");
    await expect(ask).toContainText("Your GPU has 4.0 GB");
    await shoot(page, "models-fit-gpu-e2e");
    await ask.getByRole("button", { name: "Choose a lighter one" }).click();
    const lighter = page.getByRole("alertdialog", { name: /^(Download and use|Use) .*\?$/ });
    await expect(lighter).toBeVisible();
    await lighter.getByRole("button", { name: "Cancel" }).click();
    await expect(lighter).toBeHidden();
  });
});

test.describe("no GPU and 6 GB of memory", () => {
  mockServer(4362, { TESTIMUS_MOCK_MACHINE: "cpu-only" });

  test("no reranker is offered beside an embedding on the processor, and a model too big is refused", async ({
    page,
  }) => {
    const models = await openModels(page);
    const rr = group(models, "Reranker");
    await expect(rr).toContainText("With the embedding advised on the processor, a reranker would slow every query");
    await expect(group(models, "Embeddings")).toContainText("Embedding: processor, 6 cores, separate process");
    await expect(
      row(models, "Reranker models", "Qwen3 Reranker 0.6B (8-bit, GGUF)").getByRole("button", {
        name: "Use",
        exact: true,
      }),
    ).toBeDisabled();
    // a model too big for the memory is refused where it is listed: the numbers under its name, its Use disabled
    const big = row(models, "Embedding models", "Qwen3 Embedding 8B (4-bit)");
    await expect(big).toContainText("of memory; this PC has 6.0 GB");
    await expect(big.getByRole("button", { name: "Use", exact: true })).toBeDisabled();
    await top(big);
    await shoot(page, "models-fit-ram-e2e");
  });
});

test.describe("first download, no models folder chosen", () => {
  const server = mockServer(4363, { TESTIMUS_MOCK_MODELS_DIR: "unset", TESTIMUS_MOCK_LLAMACPP: "absent" });

  test("the first download asks where models go, then Change… moves them", async ({ page }) => {
    const root = await sandbox(server.url);
    const models = await openModels(page);
    await expect(models).toContainText("Not chosen yet — Testimus asks on the first download.");
    await expect(group(models, "Reranker")).toContainText("llama.cpp not installed");
    await expect(group(models, "Reranker").getByRole("button", { name: "Download llama.cpp" })).toBeVisible();
    const name = "Qwen3 Embedding 0.6B (16-bit, DirectML)";
    await row(models, "Embedding models", name).getByRole("button", { name: "Use", exact: true }).click();
    const where = page.getByRole("dialog", { name: "Where should models be stored?" });
    await typeFolder(where, join(root, "first-models"));
    await expect(where.getByRole("status")).toContainText("free on");
    await shoot(page, "models-folder-first-e2e");
    await where.getByRole("button", { name: "Store models here" }).click();
    const plan = page.getByRole("alertdialog", { name: `Download and use ${name}?` });
    await plan.getByRole("button", { name: /^Download \S+ [MG]B and use$/ }).click();
    await expect(row(models, "Embedding models", name)).toContainText("In use", { timeout: 30_000 });
    await expect(models).toContainText(join(root, "first-models"));

    await models.getByRole("button", { name: "Change…" }).first().click();
    const change = page.getByRole("dialog", { name: "Change the models folder" });
    const moved = join(root, "moved-models");
    await typeFolder(change, moved);
    const how = change.getByRole("radiogroup", { name: "The models already downloaded" });
    await how.getByRole("radio", { name: /^Keep them where they are/ }).click();
    await expect(change).toContainText("They stay where they are");
    await how.getByRole("radio", { name: /^Copy/ }).click();
    await how.getByRole("radio", { name: /^Move/ }).click();
    await expect(change).toContainText(/Moving .* runs as a job, in the background\./);
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
