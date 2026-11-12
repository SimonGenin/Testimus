import { boot, expect, mockServer, shoot, test } from "./helpers.ts";

mockServer(4374, { TESTIMUS_MOCK_CLAUDE_STEP_MS: "600" });

test("while Claude writes, the test it is on is shown below the tree and grows, then the next one; a test picked stays", async ({
  page,
}) => {
  await boot(page, "#/generate");
  const request = page.getByRole("region", { name: "Request" });
  const result = page.getByRole("region", { name: "Result" });
  await request.getByRole("checkbox", { name: "Review the plan before writing" }).uncheck();
  await request.getByRole("textbox", { name: "What should be tested?" }).fill("Le menu contextuel du sectionneur");
  await request.getByRole("button", { name: "Generate" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete and generate" }).click();

  const tests = result.getByRole("region", { name: "Tests written" });
  await expect(tests).toContainText("Read only while Claude writes");
  const tree = tests.getByRole("tree", { name: "Tests of the generation" });
  const row = (name: RegExp) => tree.getByRole("treeitem", { name });
  const card = (name: RegExp) => tests.getByRole("region", { name });
  await expect(card(/^Sectionneur sans TK/)).toBeVisible({ timeout: 20_000 });
  const first = card(/^Sectionneur sans TK/);
  await expect(first.getByText("Writing")).toBeVisible();
  await expect(first.getByText("Step 1", { exact: true })).toBeVisible();
  await expect(first.getByText("Step 4", { exact: true })).toBeVisible({ timeout: 10_000 });
  for (const field of await first.getByRole("textbox").all()) await expect(field).toHaveAttribute("readonly", "");

  await expect(card(/^Sectionneur avec TK/)).toBeVisible({ timeout: 20_000 });
  await expect(card(/^Sectionneur sans TK/)).toHaveCount(0);
  await expect(row(/^Sectionneur sans TK/)).toContainText("Written");
  await expect(row(/^Traction/)).toContainText("1 / 2");
  await shoot(page, "generate-writing");

  await row(/^Sectionneur sans TK/).click();
  await expect(card(/^Sectionneur sans TK/)).toBeVisible();
  await expect(card(/^Sectionneur avec TK/)).toHaveCount(0);

  await expect(result.getByRole("heading", { name: "2 tests written", exact: true })).toBeVisible({ timeout: 40_000 });
  await expect(row(/^Sectionneur (sans|avec) TK/)).toHaveCount(2);
  await expect(card(/^Sectionneur (sans|avec) TK/).getByRole("button", { name: /Review/ })).toBeVisible();
});
