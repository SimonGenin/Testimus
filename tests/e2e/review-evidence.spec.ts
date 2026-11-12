import { boot, expect, mockServer, shoot, test } from "./helpers.ts";

mockServer(4369);

test("a misplaced quote is not highlighted, and the panel lists no sources read", async ({ page }) => {
  await boot(page, "#/generate");
  const request = page.getByRole("region", { name: "Request" });
  const result = page.getByRole("region", { name: "Result" });
  await request.getByRole("checkbox", { name: "Review the plan before writing" }).uncheck();
  await request.getByRole("textbox", { name: "What should be tested?" }).fill("Le sectionneur avec TK");
  await request.getByRole("button", { name: /^Generate/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete and generate" }).click();
  await expect(result.getByRole("heading", { name: "2 tests written", exact: true })).toBeVisible({ timeout: 20_000 });
  await result
    .getByRole("tree", { name: "Tests of the generation" })
    .getByRole("treeitem", { name: /^Sectionneur avec TK/ })
    .click();
  await result
    .getByRole("region", { name: /^Sectionneur avec TK/ })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await expect(page).toHaveURL(/#\/(tests|review)\/local-[0-9a-f]{8}$/);
  const under = page.getByRole("region", { name: "Test under review" });
  await expect(under.getByRole("heading", { level: 2 })).toHaveText(/^Sectionneur avec TK/);

  const step2 = under.getByRole("article", { name: "Step 2", exact: true });
  await step2.getByRole("button", { name: /^SOSIE_211_D401-1_3 §5\.6\.7 “les points/ }).click();
  const panel = page.getByRole("complementary", { name: "Source passage" });
  await expect(panel.getByRole("alert").filter({ hasText: "The quote is not at this anchor" })).toBeVisible();
  await expect(panel.locator("mark")).toHaveCount(0);

  await expect(panel.getByRole("button", { name: /^Sources read/ })).toHaveCount(0);
  await shoot(page, "review-evidence-e2e");
});
