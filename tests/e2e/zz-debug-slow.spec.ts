import { expect, mockServer, test } from "./helpers.ts";

const server = mockServer(4391, { TESTIMUS_MOCK_CLAUDE_MS: "60000", TESTIMUS_MOCK_JIRA_MS: "1500" });

test("debug slow generate", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${server.url}/#/generate`);
  const again = page.getByRole("button", { name: "New request" });
  await again
    .or(page.getByRole("textbox", { name: "What should be tested?" }))
    .first()
    .waitFor({ timeout: 15_000 });
  console.log("again visible", await again.isVisible());
  if (await again.isVisible()) await again.click();
  const review = page.getByRole("checkbox", { name: "Review the plan before writing" });
  if (await review.isEnabled()) await review.setChecked(false);
  console.log("review checked after", await review.isChecked());
  await page.getByRole("textbox", { name: "What should be tested?" }).fill("Le sectionneur avec TK");
  await page.getByRole("region", { name: "Request" }).getByRole("button", { name: /^Generate/ }).click();
  await page.waitForTimeout(4000);
  console.log((await page.locator("body").innerText()).slice(0, 2500));
  expect(1).toBe(1);
});
