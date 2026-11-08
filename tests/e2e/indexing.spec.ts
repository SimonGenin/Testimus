import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

type Status = { degraded: string | null; indexing: { state: string; docs: number } | null };

// ponytail: the fake embedder takes 8 s for the passages, so the run is seen while it goes
const server = mockServer(4430, {
  TESTIMUS_MOCK_INDEX: "bm25",
  TESTIMUS_MOCK_ADVICE: "none",
  TESTIMUS_MOCK_INDEX_MS: "8000",
});

test.use({ viewport: { width: 1920, height: 1080 } });

test("while an index run goes no index warning shows — its progress does; the warnings are gone once it ends", async ({
  page,
}) => {
  await boot(page, "#/documents");
  const screen = page.getByTestId("documents-screen");
  const list = page.getByRole("region", { name: "Document list" });
  const rows = list.getByRole("option", { name: /SOSIE_/ });
  await expect(rows).toHaveCount(2);
  await expect(screen.getByText("Search on words only")).toBeVisible();
  await expect(rows.first()).toContainText("Not up to date");

  const { jobId } = await api<{ jobId: string }>(server.url, "rag.index", {});
  expect(jobId).toBeTruthy();
  const bar = list.getByRole("progressbar", { name: "Index" });
  await expect(bar).toBeVisible();
  await expect(list).toContainText(/Indexing 1 of 5 documents · 0 of \d+ passages/);
  await expect(list.getByRole("option").first()).toContainText("Indexing · 0 %");
  await expect(rows.first()).toContainText("Waiting to index");
  await expect(rows.nth(1)).toContainText("Waiting to index");
  await expect(list).not.toContainText("Not up to date");
  await expect(screen.getByText("Search on words only")).toHaveCount(0);
  const status = await api<Status>(server.url, "rag.status");
  expect(status.degraded).not.toBeNull();
  expect(status.indexing).toMatchObject({ state: "running", docs: 5 });
  await shoot(page, "documents-indexing-e2e");

  await page.goto("/#/settings/search");
  const search = page.getByRole("region", { name: "Search", exact: true });
  await expect(search.getByText("Used on this PC")).toBeVisible();
  await expect(search.getByText("Search on words only")).toHaveCount(0);
  await expect(search.getByText("Words only", { exact: true })).toHaveCount(0);

  await page.goto("/#/documents");
  await expect(rows.first()).toContainText("Indexed", { timeout: 30_000 });
  await expect(rows.nth(1)).toContainText("Indexed");
  await expect(bar).toHaveCount(0);
  await expect(screen.getByText("Search on words only")).toHaveCount(0);
  expect((await api<Status>(server.url, "rag.status")).indexing).toBeNull();
});
