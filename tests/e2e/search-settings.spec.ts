import type { Page } from "@playwright/test";
import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

type Space = { id: string; model: string; complete: boolean; active: boolean };

async function openSearch(page: Page) {
  await boot(page, "#/settings/search");
  const search = page.getByRole("region", { name: "Search", exact: true });
  await expect(search.getByText("In use", { exact: true })).toBeVisible();
  await search.getByRole("heading", { name: "Search", exact: true }).evaluate((e) => e.scrollIntoView());
  return search;
}

const SPACE = /[0-9a-f]{12}, \d+ dims/;

async function openUses(page: Page) {
  const fold = page.getByRole("button", { name: /^Where search is used, and the filters it takes/ });
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "true");
}

test.describe("vectors built, this PC's choice", () => {
  const server = mockServer(4366);

  test("the section names the models in use, with no fixed list and no pack", async ({ page }) => {
    const search = await openSearch(page);
    const models = search.getByRole("region", { name: "Search models" });
    await expect(models).toContainText("Embedding: BGE-M3 (8-bit, CPU)");
    await expect(search).not.toContainText(/pack|team/i);
    await expect(search.getByRole("radio", { name: /pack|BGE|Qwen/i })).toHaveCount(0);
    await expect(search).not.toContainText("Search on words only");
    const spaces = search.getByRole("table", { name: "Vector spaces" });
    await expect(spaces.getByRole("row", { name: SPACE })).toHaveCount(1);
    await expect(spaces).toContainText("In use here");
    await shoot(page, "search-settings-e2e");
  });

  test("who uses what: Claude never with the reranker, the index builds, the models of the pack in use", async ({
    page,
  }) => {
    const search = await openSearch(page);
    await openUses(page);
    const who = search.getByRole("table", { name: "Who uses what on this PC" });
    const row = (name: RegExp) => who.getByRole("row", { name });
    await expect(row(/^Claude, while it writes or checks tests/)).toContainText("BGE-M3 (8-bit, CPU)");
    await expect(row(/^Claude, while it writes or checks tests/)).toContainText("Never");
    await expect(row(/^Claude, while it writes or checks tests/)).toContainText("not in Claude's loop");
    await expect(row(/^Search everything/)).toContainText("Always");
    await expect(row(/^The index of the documents/)).toContainText("Builds it");
    await expect(who).not.toContainText("Qwen3");
    await api(server.url, "models.use", { embedding: "qwen3-embedding-0.6b-onnx-q8", reranker: null });
    await page.reload();
    await openUses(page);
    await expect(row(/^Search everything/)).toContainText("Qwen3 Embedding 0.6B (8-bit, CPU)", { timeout: 30_000 });
    await expect(row(/^Search everything/)).toContainText("None in the models in use");
    await expect(who).not.toContainText("BGE-M3");
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
    await expect(spaces.getByRole("row", { name: SPACE })).toHaveCount(2);
    await shoot(page, "search-spaces-e2e");
    await spaces.getByRole("button", { name: `Drop space ${old?.id}` }).click();
    const ask = page.getByRole("alertdialog", { name: "Drop the BGE-M3 (8-bit, CPU) vectors?" });
    await expect(ask).not.toContainText("falls back to words only");
    await ask.getByRole("button", { name: /^Drop / }).click();
    await expect(spaces.getByRole("row", { name: SPACE })).toHaveCount(1);
    await expect(spaces).toContainText("Qwen3 Embedding 0.6B (8-bit, CPU)");
  });
});

test.describe("search settings: edited, tried, measured, saved", () => {
  const server = mockServer(4368);

  test("a setting changed is tried with its why, measured, then saved to project.json", async ({ page }) => {
    const search = await openSearch(page);
    await search.getByRole("radiogroup", { name: "Words or meaning" }).getByRole("radio", { name: "Words" }).click();
    const typos = search.getByRole("switch", { name: "Also look one letter away" });
    await typos.click();
    await expect(typos).toHaveAttribute("aria-checked", "true");
    const chips = search.getByRole("textbox", { name: "Synonyms and acronyms" });
    await chips.fill("pilotage = télécommande");
    await chips.press("Enter");
    await expect(search.getByText(/Not saved: Try it and Measure use these settings/)).toBeVisible();

    await search.getByRole("searchbox", { name: "Try a search" }).fill("pilotage sectionneurr");
    const found = search.getByRole("list", { name: "Passages found" });
    await expect(found.getByRole("listitem").first()).toContainText("words #1", { timeout: 15_000 });
    await expect(found).toContainText("synonym pilotage → télécommande");
    await expect(found).toContainText("typo sectionneurr → sectionneur");
    await shoot(page, "search-try-it-e2e");

    await search.getByRole("button", { name: "Measure on the benchmark" }).click();
    await expect(search.getByText(/saved → .* with these settings/)).toBeVisible({ timeout: 60_000 });

    expect(
      (await api<{ project: { rag: { retrieval?: unknown } } }>(server.url, "project.info")).project.rag.retrieval,
    ).toBeUndefined();
    await search.getByRole("button", { name: "Save to project.json" }).click();
    await expect(search.getByRole("button", { name: "Save to project.json" })).toHaveCount(0);
    const saved = await api<{ project: { rag: { retrieval?: unknown } } }>(server.url, "project.info");
    expect(saved.project.rag.retrieval).toEqual({
      rrfWeights: [2, 1],
      typos: true,
      synonyms: [["pilotage", "télécommande"]],
    });

    await search.getByRole("button", { name: "Back to the defaults" }).click();
    await search.getByRole("button", { name: "Save to project.json" }).click();
    await expect
      .poll(
        async () =>
          (await api<{ project: { rag: { retrieval?: unknown } } }>(server.url, "project.info")).project.rag.retrieval,
      )
      .toEqual({ typos: true, synonyms: [["pilotage", "télécommande"]] });
  });
});

test.describe("an index with words only", () => {
  mockServer(4367, { TESTIMUS_MOCK_INDEX: "bm25", TESTIMUS_MOCK_ADVICE: "none" });

  test("search says it runs on words only until Reindex builds the vectors", async ({ page }) => {
    const search = await openSearch(page);
    await expect(search.getByRole("region", { name: "Search models" })).toContainText("Embedding: BGE-M3 (8-bit, CPU)");
    const degraded = search.getByRole("alert").filter({ hasText: "Search on words only" });
    await expect(degraded).toContainText("No vectors for bge-m3-q8 yet");
    await expect(search).toContainText("no vectors for the active model");
    await expect(search).toContainText("None yet");
    await shoot(page, "search-degraded-e2e");
    await search.getByRole("button", { name: "Reindex" }).click();
    await expect(search.getByText("Up to date", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(search.getByText("Search on words only")).toHaveCount(0);
    await expect(search.getByRole("table", { name: "Vector spaces" })).toContainText("In use here");
  });
});
