import { boot, expect, mockServer, shoot, test } from "./helpers.ts";

mockServer(4369);

test("a generated test shows the sources it read; a misplaced quote is not highlighted", async ({ page }) => {
  await boot(page, "#/generate");
  const request = page.getByRole("region", { name: "Request" });
  const result = page.getByRole("region", { name: "Result" });
  await request.getByRole("textbox", { name: "What should be tested?" }).fill("Le sectionneur avec TK");
  await request.getByRole("button", { name: /^Generate/ }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete and generate" }).click();
  await expect(result.getByRole("heading", { name: "2 tests written", exact: true })).toBeVisible({ timeout: 20_000 });
  await result
    .getByRole("region", { name: /^Sectionneur avec TK/ })
    .first()
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

  const head = panel.getByRole("button", { name: /^Sources read/ });
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(panel.getByText("2 read", { exact: true })).toBeVisible();
  await head.click();
  const evidence = panel.getByRole("region", { name: "Sources read" });
  await expect(evidence.getByText("Read by the generation")).toBeVisible();
  const read = evidence.getByRole("option", { name: /SOSIE_211_D401-1_3#§5\.6\.6/ });
  await expect(read).toBeVisible();
  await expect(evidence).toContainText("Cited");
  await shoot(page, "review-evidence-e2e");

  await read.click();
  await expect(panel).toContainText("Selon le type de sectionneur");
});
