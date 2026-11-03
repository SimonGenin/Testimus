import { boot, expect, mockServer, shoot, test } from "./helpers.ts";

mockServer(4369);

test("a generated test shows the sources it read; a misplaced quote is not highlighted", async ({ page }) => {
  await boot(page, "#/generate");
  const request = page.getByRole("region", { name: "Request" });
  const result = page.getByRole("region", { name: "Result" });
  await request.getByRole("textbox", { name: "What should be tested?" }).fill("Le sectionneur avec TK");
  await request.getByRole("button", { name: /^Generate/ }).click();
  await expect(result.getByRole("heading", { name: "2 tests written" })).toBeVisible({ timeout: 20_000 });
  await result
    .getByRole("button", { name: /^Sectionneur avec TK/ })
    .first()
    .click();
  await expect(page).toHaveURL(/#\/(tests|review)\/local-[0-9a-f]{8}$/);
  const under = page.getByRole("region", { name: "Test under review" });
  await expect(under.getByRole("heading", { level: 2 })).toHaveText(/^Sectionneur avec TK/);

  const step2 = under.getByRole("article", { name: "Step 2", exact: true });
  await step2.getByRole("button", { name: /^SOSIE_211_D401-1_3 §5\.6\.7 « les points/ }).click();
  const panel = page.getByRole("complementary", { name: "Source passage" });
  await expect(panel.getByRole("status").filter({ hasText: "Quote not at this anchor" })).toBeVisible();
  await expect(panel.locator("mark")).toHaveCount(0);

  const evidence = page.getByRole("region", { name: "Sources read" });
  const head = evidence.getByRole("button", { name: /^Sources read/ });
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(head).toContainText("2 read");
  await head.click();
  await expect(evidence.getByText("Read by the generation (2)")).toBeVisible();
  const read = evidence.getByRole("button", { name: /SOSIE_211_D401-1_3#§5\.6\.6/ });
  await expect(read).toBeVisible();
  await expect(evidence).toContainText("Cited");
  await shoot(page, "review-evidence-e2e");

  await read.click();
  await expect(panel).toContainText("Selon le type de sectionneur");
});
