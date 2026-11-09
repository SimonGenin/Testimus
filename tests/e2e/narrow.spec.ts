import { boot, expect, mockServer, openTest, shoot, test } from "./helpers.ts";

mockServer(4395);

test.use({ viewport: { width: 520, height: 600 } });

test("the editor fits a 520 px window beside Jira: the test bar wraps, the list folds to its strip", async ({
  page,
}) => {
  await openTest(page, "LFRPS12-1420");
  const main = page.getByRole("main");
  await expect(main.getByRole("button", { name: "Push to Jira" })).toBeInViewport();
  await expect(main.getByRole("button", { name: "More actions for this test" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const strip = page.getByRole("navigation", { name: "Section 1, collapsed" });
  await expect(strip).toBeInViewport();
  await strip.getByRole("button", { name: /^Tests/ }).click();
  await expect(
    page.getByRole("complementary", { name: "Tests" }).getByRole("searchbox", { name: "Filter tests" }),
  ).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await shoot(page, "narrow-editor", ["light"]);
});

for (const hash of ["#/documents", "#/generate", "#/jobs", "#/settings", "#/doctor"])
  test(`${hash} fits a 520 px window`, async ({ page }) => {
    await boot(page, hash);
    await expect(page.getByRole("heading", { level: 1 })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    const actions = page.locator(".screenhead-actions button");
    for (const b of await actions.all()) await expect(b).toBeInViewport();
  });

test("#/review fits a 520 px window", async ({ page }) => {
  await boot(page, "#/review");
  await expect(page.getByRole("button", { name: /^Validate(?!d)/ })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("#/setup, the first-run screen, fits a 520 px window", async ({ page }) => {
  await page.goto("/#/setup");
  await expect(page.getByRole("heading", { level: 1, name: "Welcome to Testimus" })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await page.goto("/#/setup/access");
  await expect(page.getByRole("heading", { level: 1, name: "Connect to Jira and Xray" })).toBeInViewport();
  await page.getByRole("button", { name: "Change the access" }).click();
  await expect(page.getByRole("textbox", { name: "Jira site" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const save = page.getByRole("button", { name: "Save and test the connection" });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("#/tests with no test open fits a 520 px window", async ({ page }) => {
  await boot(page, "#/tests");
  const main = page.getByRole("main");
  await expect(main).toBeInViewport();
  await expect(main.getByText("No test open", { exact: true })).toBeInViewport();
  await expect(
    page.getByRole("navigation", { name: "Section 1, collapsed" }).getByRole("button", { name: /^Tests/ }),
  ).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test("the Claude tab opens in a 520 px window and stays usable", async ({ page }) => {
  await openTest(page, "LFRPS12-1420");
  await page
    .getByRole("navigation", { name: "Section 3, collapsed" })
    .getByRole("button", { name: /^Claude/ })
    .click();
  const dock = page.getByRole("complementary", { name: "Claude" });
  const box = dock.getByRole("textbox", { name: /Ask Claude|Ask about/ });
  await expect(box).toBeInViewport();
  const width = await dock.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  await shoot(page, "narrow-dock", ["light"]);
});

test("the split layout stacks Expected Result under Action below 760 px of card, side by side on a wide window", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 960 });
  await openTest(page, "LFRPS12-1420");
  const main = page.getByRole("main");
  await main.getByRole("radio", { name: "Action | Expected" }).click();
  const action = main.getByRole("textbox", { name: "Action of step 1" });
  const expected = main.getByRole("textbox", { name: "Expected Result of step 1" });
  const boxes = async () => {
    const [a, e] = [await action.boundingBox(), await expected.boundingBox()];
    if (!a || !e) throw new Error("the two fields of step 1 have no box");
    return { a, e };
  };
  const sideBySide = async () => {
    const { a, e } = await boxes();
    return e.x >= a.x + a.width && Math.abs(e.y - a.y) <= 2;
  };
  const stacked = async () => {
    const { a, e } = await boxes();
    return e.y >= a.y + a.height && Math.abs(e.x - a.x) <= 2;
  };
  await expect.poll(sideBySide).toBe(true);
  await page.setViewportSize({ width: 520, height: 600 });
  await expect.poll(stacked).toBe(true);
  await page.setViewportSize({ width: 1440, height: 960 });
  await expect.poll(sideBySide).toBe(true);
});
