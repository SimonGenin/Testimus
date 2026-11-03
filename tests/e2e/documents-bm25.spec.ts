import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const { url } = mockServer(4368, { TESTIMUS_MOCK_INDEX: "bm25", TESTIMUS_MOCK_ADVICE: "none" });

// ponytail: below ~1300px beside the Claude dock the document list and the settings fold into drawers
test.use({ viewport: { width: 1920, height: 1080 } });

test("documents indexed on words only still open and search, and indexing again adds the vectors", async ({ page }) => {
  const hits = await api<{ degraded?: boolean }[]>(url, "rag.search", { query: "sectionneur" });
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.every((h) => h.degraded)).toBe(true);

  await boot(page, "#/documents");
  const list = page.getByRole("region", { name: "Document list" });
  const rows = list.getByRole("row", { name: /^SOSIE_/ });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Validated");
  const detail = page.getByRole("region", { name: "SOSIE_211_D401-1_3 details" });
  await expect(detail.getByRole("heading", { name: "5.6.6 Sectionneur (S)" })).toBeVisible();
  await shoot(page, "search-documents-bm25-e2e");

  await expect(detail.getByRole("button", { name: "Reindex" })).toHaveCount(0);

  await api(url, "rag.index", {});
  await expect
    .poll(async () => (await api<{ degraded: string | null }>(url, "rag.status")).degraded, { timeout: 30_000 })
    .toBeNull();
  await page.reload();
  await expect(rows.first()).toContainText(/up to date/i);
  const after = await api<{ degraded?: boolean }[]>(url, "rag.search", { query: "sectionneur" });
  expect(after.some((h) => h.degraded)).toBe(false);
});
