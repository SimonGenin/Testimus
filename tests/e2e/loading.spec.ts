import { boot, expect, mockServer, shoot, test } from "./helpers.ts";

// ponytail: the tests list answers 12 s after each time it is asked (TESTIMUS_MOCK_READ_MS), so every state of the
// loading line is seen: the skeleton alone, what loads and the seconds, then « answering slowly » and Try again
mockServer(4493, { TESTIMUS_MOCK_READ_MS: "tests.list=12000" });

test("a slow read: the skeleton, then what loads and the seconds, then that it is slow; Try again asks it again", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const asked: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/tests/list")) asked.push(r.url());
  });
  await boot(page, "#/tests");
  const rows = page.getByRole("status", { name: "Loading tests" });
  await expect(rows).toBeVisible();
  const line = rows.getByRole("status").filter({ hasText: /Loading the tests…/ });
  await expect(line).toHaveText(/^Loading the tests… [1-9] s$/, { timeout: 5_000 });
  await expect(line).toHaveCount(1);
  await expect(page.getByText("Testimus is answering slowly. The page keeps waiting.")).toHaveCount(0);
  const slow = rows.getByRole("status").filter({ hasText: /Still loading the tests…/ });
  await expect(slow).toHaveText(/^Still loading the tests… 1\d s$/, { timeout: 15_000 });
  await expect(page.getByText("Testimus is answering slowly. The page keeps waiting.")).toBeVisible();
  await shoot(page, "loading-slow-tests");
  const before = asked.length;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect.poll(() => asked.length).toBe(before + 1);
  await expect(page.getByText("Testimus is answering slowly. The page keeps waiting.")).toHaveCount(0);
  await expect(rows).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(/Loading the tests…/)).toHaveCount(0);
  expect(asked).toHaveLength(before + 1);
});

test("a skeleton shimmers, and stands still when the system asks for less motion", async ({ page }) => {
  const bar = page.getByRole("status", { name: "Loading tests" }).locator('[aria-hidden="true"] span').first();
  const motion = () => bar.evaluate((el) => getComputedStyle(el).animationName);
  await boot(page, "#/tests");
  await expect(bar).toBeVisible();
  expect(await motion()).not.toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(motion).toBe("none");
});
