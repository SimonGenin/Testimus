import { boot, expect, mockServer, shoot, test } from "./helpers.ts";

mockServer(4374, { TESTIMUS_MOCK_CLAUDE_STEP_MS: "600" });

test("while Claude writes, the test it is on is open and grows, folds when done, and the next one opens", async ({
  page,
}) => {
  await boot(page, "#/generate");
  const request = page.getByRole("region", { name: "Request" });
  const result = page.getByRole("region", { name: "Result" });
  await request.getByRole("textbox", { name: "What should be tested?" }).fill("Le menu contextuel du sectionneur");
  await request.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete and generate" }).click();

  const tests = result.getByRole("region", { name: "Tests written" });
  await expect(tests).toContainText("Read only while Claude writes");
  const head = (name: RegExp) => tests.getByRole("button", { name });
  const sans = head(/^Sectionneur sans TK/);
  await expect(sans).toHaveAttribute("aria-expanded", "true", { timeout: 20_000 });
  const first = tests.getByRole("region", { name: /^Sectionneur sans TK/ });
  await expect(first.getByText("Writing")).toBeVisible();
  await expect(first.getByText("Step 1", { exact: true })).toBeVisible();
  await expect(first.getByText("Step 4", { exact: true })).toBeVisible({ timeout: 10_000 });
  for (const field of await first.getByRole("textbox").all()) await expect(field).toHaveAttribute("readonly", "");

  const avec = head(/^Sectionneur avec TK/);
  await expect(avec).toHaveAttribute("aria-expanded", "true", { timeout: 20_000 });
  await expect(sans).toHaveAttribute("aria-expanded", "false");
  await expect(first).toContainText("Written");
  await shoot(page, "generate-writing");

  await sans.click();
  await expect(sans).toHaveAttribute("aria-expanded", "true");
  await tests.getByRole("button", { name: "Fold all" }).click();
  await expect(sans).toHaveAttribute("aria-expanded", "false");
  await expect(avec).toHaveAttribute("aria-expanded", "false");
  await sans.click();

  await expect(result.getByRole("heading", { name: "2 tests written", exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(result.getByRole("region", { name: /^Sectionneur (sans|avec) TK/ })).toHaveCount(2);
  await expect(page.getByRole("region", { name: "Tests written" }).getByRole("button", { name: /Review/ })).toHaveCount(
    2,
  );
});
