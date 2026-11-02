import { api, boot, expect, mockServer, shoot, test, waitForJob } from "./helpers.ts";

const { url } = mockServer(4351);

test("a running job shows its live log, then its result", async ({ page }) => {
  await boot(page, "#/jobs");
  await expect(page.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No job yet" })).toBeVisible();
  await shoot(page, "jobs-empty");

  await api(url, "gen.tests", { request: "Le menu contextuel du sectionneur" });
  const list = page.getByRole("region", { name: "Job list" });
  const row = list.getByRole("row", { name: /^Generate tests Le menu contextuel du sectionneur/ });
  await expect(row).toBeVisible();
  await row.click();
  const detail = page.getByRole("complementary", { name: "Generate tests job" });
  await expect(detail.getByRole("log", { name: "Live log" })).toContainText("Reading passages");
  await expect(detail.getByText(/^Done · 2 tests written$/)).toBeVisible({ timeout: 20_000 });
  await expect(detail.getByRole("log", { name: "Live log" })).toContainText("Claude finished");
  await shoot(page, "jobs");
  await detail.getByRole("button", { name: "Review these tests" }).click();
  await expect(page).toHaveURL(/#\/review/);
});

test("a running job is cancelled from its detail", async ({ page }) => {
  await boot(page, "#/jobs");
  const { jobId } = await api<{ jobId: string }>(url, "gen.tests", { request: "Le disjoncteur à distance" });
  const list = page.getByRole("region", { name: "Job list" });
  await list.getByRole("row", { name: /^Generate tests Le disjoncteur à distance/ }).click();
  const detail = page.getByRole("complementary", { name: "Generate tests job" });
  await detail.getByRole("button", { name: "Cancel" }).click();
  await expect(detail.getByText(/^Cancel/).first()).toBeVisible();
  await waitForJob(url, jobId);
  const job = await api<{ job: { status: string } }>(url, "jobs.show", { id: jobId });
  expect(job.job.status).toBe("cancelled");
  await expect(list.getByRole("row", { name: /^Generate tests Le disjoncteur à distance/ })).toContainText(/Cancel/);
});
