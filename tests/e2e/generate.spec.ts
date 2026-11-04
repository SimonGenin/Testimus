import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const { url } = mockServer(4348);

test("a request runs live, the tests land, and « Review these tests » opens them", async ({ page }) => {
  const before = (await api<unknown[]>(url, "tests.list")).length;
  await boot(page, "#/generate");
  await expect(page.getByRole("heading", { level: 1, name: "Generate" })).toBeVisible();
  const request = page.getByRole("region", { name: "Request" });
  const result = page.getByRole("region", { name: "Result" });
  const docs = request.getByRole("list", { name: "Documents in scope" });
  await expect(docs.getByRole("checkbox")).toHaveCount(2);
  for (const box of await docs.getByRole("checkbox").all()) await expect(box).toBeChecked();
  await expect(request.getByRole("button", { name: "Generate" })).toBeEnabled();
  await request.getByRole("button", { name: "Select none" }).click();
  await expect(request.getByRole("button", { name: "Generate" })).toBeDisabled();
  await request.getByRole("button", { name: "Select all" }).click();
  await expect(request.getByRole("list", { name: "Smart columns" }).getByText("Exigence")).toBeVisible();
  await expect(result.getByText("Tests appear here as Claude writes them")).toBeVisible();
  await shoot(page, "generate");

  await request.getByRole("button", { name: "Only some sections…" }).first().click();
  await request
    .getByRole("button", { name: /^Unfold/ })
    .first()
    .click();
  await expect(request.getByRole("list", { name: "Sections" }).getByRole("checkbox").first()).toBeVisible();
  await request.getByRole("button", { name: "Text", exact: true }).first().click();
  await shoot(page, "generate-sections");
  await request.getByRole("button", { name: "Back to the whole document" }).click();

  await request
    .getByRole("textbox", { name: "What should be tested?" })
    .fill("Le menu contextuel du sectionneur sur la vue de traction");
  await request.getByRole("button", { name: "Generate" }).click();
  const replace = page.getByRole("alertdialog", { name: "Replace the tests not validated yet?" });
  await expect(replace).toContainText("deletes the 1 test Claude wrote that is not validated yet");
  await shoot(page, "generate-replace");
  await replace.getByRole("button", { name: "Delete and generate" }).click();
  await expect(result.getByText("Claude is writing")).toBeVisible();
  await expect(result.getByRole("button", { name: "Cancel" })).toBeVisible();
  await shoot(page, "generate-running");

  await expect(result.getByRole("heading", { name: "2 tests written", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(result.getByText(/^Not covered · \d+ — and why$/)).toBeVisible();
  await expect(result.getByText(/sectionneur avec TK/).first()).toBeVisible();
  const landed = result.getByRole("button", { name: /^Sectionneur (sans|avec) TK/ });
  await expect(landed).toHaveCount(2);
  await expect.poll(async () => (await api<unknown[]>(url, "tests.list")).length).toBe(before - 1 + 2);
  await expect(result.getByText("1 test not validated yet was deleted before this run.")).toBeVisible();
  await shoot(page, "generate-done");

  await result.getByRole("button", { name: "Review these tests" }).click();
  await expect(page).toHaveURL(/#\/review/);
  await expect(page.getByRole("region", { name: "Test under review" }).getByRole("heading", { level: 2 })).toHaveText(
    /^Sectionneur (sans|avec) TK/,
  );
});

test("a landed test opens for review with its findings", async ({ page }) => {
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
    .getByRole("button", { name: "Open in Review" })
    .click();
  await expect(page).toHaveURL(/#\/(tests|review)\/local-[0-9a-f]{8}$/);
  const under = page.getByRole("region", { name: "Test under review" });
  await expect(under.getByRole("heading", { level: 2 })).toHaveText(/^Sectionneur avec TK/);
  await expect(under.getByRole("note").first()).toBeVisible();
});
