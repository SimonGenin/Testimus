import type { Page } from "@playwright/test";
import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

type Space = { id: string; model: string; complete: boolean; active: boolean };

async function openSearch(page: Page) {
  await boot(page, "#/settings/search");
  const search = page.getByRole("region", { name: "Search", exact: true });
  await expect(search.getByText("Used on this PC")).toBeVisible();
  await search.getByRole("heading", { name: "Search", exact: true }).evaluate((e) => e.scrollIntoView());
  return search;
}

test.describe("vectors built, this PC's choice", () => {
  const server = mockServer(4366);

  test("the section names the models in use and where the choice comes from, with no fixed list", async ({ page }) => {
    const search = await openSearch(page);
    await expect(search).toContainText("BGE-M3 (8-bit, CPU)");
    await expect(search).toContainText("This PC's choice");
    await expect(search).toContainText("Not set: the Light pack");
    await expect(search.getByRole("radio")).toHaveCount(0);
    await expect(search).not.toContainText("Search on words only");
    const spaces = search.getByRole("table", { name: "Vector spaces" });
    await expect(spaces.getByRole("row", { name: /Space [0-9a-f]{12}/ })).toHaveCount(1);
    await expect(spaces).toContainText("In use here");
    await shoot(page, "search-settings-e2e");
  });

  test("a second model gets its own space; the old one is dropped", async ({ page }) => {
    await api(server.url, "models.use", { embedding: "qwen3-embedding-0.6b-onnx-q8", reranker: null });
    await expect
      .poll(async () => (await api<Space[]>(server.url, "rag.spaces")).filter((s) => s.complete).length, {
        timeout: 30_000,
      })
      .toBe(2);
    const old = (await api<Space[]>(server.url, "rag.spaces")).find((s) => s.model === "bge-m3-q8");
    const search = await openSearch(page);
    await expect(search).toContainText("Qwen3 Embedding 0.6B (8-bit, CPU)");
    const spaces = search.getByRole("table", { name: "Vector spaces" });
    await expect(spaces.getByRole("row", { name: /Space [0-9a-f]{12}/ })).toHaveCount(2);
    await shoot(page, "search-spaces-e2e");
    await spaces.getByRole("button", { name: `Drop space ${old?.id}` }).click();
    const ask = page.getByRole("alertdialog", { name: "Drop the BGE-M3 (8-bit, CPU) vectors?" });
    await expect(ask).not.toContainText("falls back to words only");
    await ask.getByRole("button", { name: /^Drop / }).click();
    await expect(spaces.getByRole("row", { name: /Space [0-9a-f]{12}/ })).toHaveCount(1);
    await expect(spaces).toContainText("Qwen3 Embedding 0.6B (8-bit, CPU)");
  });
});

test.describe("an index with words only", () => {
  mockServer(4367, { TESTIMUS_MOCK_INDEX: "bm25", TESTIMUS_MOCK_ADVICE: "none" });

  test("search says it runs on words only until Reindex builds the vectors", async ({ page }) => {
    const search = await openSearch(page);
    await expect(search).toContainText("The Light pack (default)");
    const degraded = search.getByRole("alert").filter({ hasText: "Search on words only" });
    await expect(degraded).toContainText("No vectors for bge-m3-q8 yet");
    await expect(search).toContainText("no vectors for the active model");
    await expect(search).toContainText("None yet");
    await shoot(page, "search-degraded-e2e");
    await search.getByRole("button", { name: "Reindex" }).click();
    await expect(search).toContainText("Index up to date", { timeout: 30_000 });
    await expect(search.getByText("Search on words only")).toHaveCount(0);
    await expect(search.getByRole("table", { name: "Vector spaces" })).toContainText("In use here");
  });
});
