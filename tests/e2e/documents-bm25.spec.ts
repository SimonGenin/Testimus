import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const { url } = mockServer(4368, { TESTIMUS_MOCK_INDEX: "bm25", TESTIMUS_MOCK_ADVICE: "none" });

test("documents indexed on words only still open and search, and Reindex adds the vectors", async ({ page }) => {
  const hits = await api<{ degraded?: boolean }[]>(url, "rag.search", { query: "sectionneur" });
  expect(hits.length).toBeGreaterThan(0);
  expect(hits.every((h) => h.degraded)).toBe(true);

  await boot(page, "#/documents");
  const list = page.getByRole("region", { name: "Document list" });
  const rows = list.getByRole("row", { name: /^SOSIE_/ });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Validated");
  const detail = page.getByRole("complementary", { name: "SOSIE_211_D401-1_3 details" });
  await expect(detail.getByRole("heading", { name: "5.6.6 Sectionneur (S)" })).toBeVisible();
  await shoot(page, "search-documents-bm25-e2e");

  await detail.getByRole("button", { name: "Reindex" }).click();
  await expect
    .poll(async () => (await api<{ degraded: string | null }>(url, "rag.status")).degraded, { timeout: 30_000 })
    .toBeNull();
  await expect(rows.first()).toContainText(/up to date/i);
  const after = await api<{ degraded?: boolean }[]>(url, "rag.search", { query: "sectionneur" });
  expect(after.some((h) => h.degraded)).toBe(false);
});
