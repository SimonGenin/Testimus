import { api, boot, expect, mockServer, shoot, test, waitForJob } from "./helpers.ts";

const server = mockServer(4351);

test("a running job opens from the top bar in the Job tab beside the screen, shows its live steps, then leads to what it made", async ({
  page,
}) => {
  await boot(page, "#/tests");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /^Jobs/ })).toHaveCount(0);
  await api(server.url, "gen.tests", { request: "Le menu contextuel du sectionneur" });
  await page.getByRole("button", { name: "1 job running" }).click();
  await page
    .getByRole("dialog", { name: /^Running 1/ })
    .getByRole("button", { name: /Generate tests.*Le menu contextuel du sectionneur/ })
    .click();
  const panel = page.getByRole("complementary", { name: "Generate tests" });
  await expect(panel.getByText("Le menu contextuel du sectionneur")).toBeVisible();
  await expect(panel.getByRole("list", { name: "Steps" })).toContainText("Read the sources");
  await expect(panel.getByText(/^2 tests written$/)).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole("list", { name: "Steps" })).toContainText("Check the new tests");
  await expect(panel.getByText(/pid \d+/)).toHaveCount(0);
  await panel.getByRole("button", { name: "Show the full log" }).click();
  await expect(panel.getByRole("log", { name: "Live log" })).toContainText("Claude finished");
  await shoot(page, "job-panel");
  await panel.getByRole("button", { name: "Review these tests" }).click();
  await expect(page).toHaveURL(/#\/review/);
  await expect(panel).toBeHidden();
});

test("a running job is cancelled from its panel", async ({ page }) => {
  await boot(page, "#/tests");
  const { jobId } = await api<{ jobId: string }>(server.url, "gen.tests", { request: "Le disjoncteur à distance" });
  await page.getByRole("button", { name: "1 job running" }).click();
  await page
    .getByRole("dialog", { name: /^Running 1/ })
    .getByRole("button", { name: /Le disjoncteur à distance/ })
    .click();
  const panel = page.getByRole("complementary", { name: "Generate tests" });
  await panel.getByRole("button", { name: "Cancel" }).click();
  await waitForJob(server.url, jobId);
  const job = await api<{ job: { status: string } }>(server.url, "jobs.show", { id: jobId });
  expect(job.job.status).toBe("cancelled");
  await expect(panel.getByText("Cancelled").first()).toBeVisible();
  await panel.getByRole("button", { name: "Close the job" }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("tab", { name: "Job" })).toHaveCount(0);
});

test("a job is read beside the work: the screen stays usable, and no history is listed under a test", async ({
  page,
}) => {
  await boot(page, "#/tests/LFRPS12-1398");
  await expect(page.getByRole("region", { name: "History of the test" })).toHaveCount(0);
  await api(server.url, "gen.tests", { request: "Le sectionneur de ligne" });
  await page.getByRole("button", { name: "1 job running" }).click();
  await page
    .getByRole("dialog", { name: /^Running 1/ })
    .getByRole("button", { name: /Le sectionneur de ligne/ })
    .click();
  const panel = page.getByRole("complementary", { name: "Generate tests" });
  await expect(panel).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Job" })).toBeVisible();
  await expect(page.getByRole("main").getByRole("textbox", { name: "Summary" })).toBeVisible();
  await panel.getByRole("button", { name: "Close the job" }).click();
  await expect(panel).toBeHidden();
});

test("a job that fails stays in the top bar until it is opened, and its panel says what to do", async ({ page }) => {
  await boot(page, "#/tests");
  const { jobId } = await api<{ jobId: string }>(server.url, "docs.convert", { id: "NOPE" });
  await waitForJob(server.url, jobId);
  await page.getByRole("button", { name: "1 failed" }).click();
  const pop = page.getByRole("dialog", { name: /^Failed 1/ });
  await expect(pop).toContainText("Failed · No document NOPE.");
  await pop.getByRole("button", { name: /Convert document/ }).click();
  const panel = page.getByRole("complementary", { name: "Convert document" });
  const alert = panel.getByRole("alert");
  await expect(alert).toContainText("No document NOPE.");
  await expect(alert).toContainText("What to do:");
  await expect(panel.getByRole("button", { name: /Run again/ })).toHaveCount(1);
  await shoot(page, "job-failed");
  await panel.getByRole("button", { name: "Close the job" }).click();
  await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: /failed/ })).toHaveCount(0);
});
