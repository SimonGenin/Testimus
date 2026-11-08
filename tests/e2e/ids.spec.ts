import type { Page } from "@playwright/test";
import { api, boot, expect, mockServer, test, waitForJob } from "./helpers.ts";

const { url } = mockServer(4430);

const LOCAL_ID = /\blocal-[0-9a-f]{6,}\b/;
const LOCAL = "local-3f9a12c0";
const DOC = "SOSIE_211_D401-1_3";

// ponytail: what a person reads on the page (innerText) — the folded « Technical details », where an id may stay, is
// not visible
async function noLocalId(page: Page, where: string): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("body"), `no local test id on ${where}`).not.toContainText(LOCAL_ID, {
    useInnerText: true,
  });
}

test("no internal id on the main screens, once Claude has checked, fixed, edited and written tests", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const jobs: string[] = [];
  for (const [name, input] of [
    ["check.run", { ids: [LOCAL] }],
    ["review.fix", { id: LOCAL }],
    ["claude.run", { scope: { kind: "test", testId: LOCAL }, prompt: "Rends le step 2 plus clair" }],
    ["gen.tests", { request: "Tests du sectionneur", docs: [DOC] }],
  ] as const) {
    const { jobId } = await api<{ jobId: string }>(url, name, input);
    await waitForJob(url, jobId);
    jobs.push(jobId);
  }

  await boot(page, "#/tests");
  for (const hash of [
    "#/documents",
    `#/documents/${DOC}`,
    "#/generate",
    "#/tests",
    "#/tests/LFRPS12-1398",
    "#/review",
    `#/review/${LOCAL}`,
    "#/jobs",
    "#/settings/project",
    "#/settings/claude",
  ]) {
    await page.goto(`/${hash}`);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await noLocalId(page, hash);
  }

  for (const id of jobs) {
    await page.goto(`/#/jobs/${id}`);
    const detail = page.getByRole("complementary", { name: / job$/ });
    await expect(detail).toBeVisible();
    await noLocalId(page, `the job ${id}`);
    const log = detail.getByRole("button", { name: "Show the full log" });
    if (await log.isVisible()) await log.click();
    await noLocalId(page, `the full log of ${id}`);
  }

  const fix = page.getByRole("complementary", { name: "Claude fix job" });
  await page.goto(`/#/jobs/${jobs[1]}`);
  await expect(fix.getByText("Sectionneur avec TK — manœuvre régulière").first()).toBeVisible();
  await fix.getByRole("button", { name: "Technical details" }).click();
  const technical = fix.locator(`dl[aria-label="Technical details"]`);
  await expect(technical).toContainText(jobs[1]);
  await expect(technical).toContainText(LOCAL);

  await page.goto(`/#/review/${LOCAL}`);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("sectionneur");
  await expect(page.getByRole("dialog").getByRole("option").first()).toBeVisible();
  await noLocalId(page, "the palette");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+j");
  await expect(
    page.getByRole("complementary", { name: "Claude" }).getByRole("heading", { name: "Claude", exact: true }),
  ).toBeVisible();
  await noLocalId(page, "the Claude dock");
});
