import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleDocx } from "../fixtures/docx/sample.ts";
import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const { url } = mockServer(4350);

// ponytail: below ~1300px beside the Claude dock the document list and the settings fold into drawers
test.use({ viewport: { width: 1920, height: 1080 } });

test("the list shows each document with status and index state; the detail shows its text", async ({ page }) => {
  await boot(page, "#/documents");
  await expect(page.getByRole("heading", { level: 1, name: "Documents" })).toBeVisible();
  const list = page.getByRole("region", { name: "Document list" });
  const rows = list.getByRole("row", { name: /^SOSIE_/ });
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Validated");
  await expect(list.getByRole("columnheader", { name: "Binding" })).toHaveCount(0);
  await expect(rows.first()).toContainText(/up to date/i);
  await expect(rows.nth(1)).toContainText("Submitted");

  const detail = page.getByRole("region", { name: "SOSIE_211_D401-1_3 details" });
  await expect(detail.getByRole("heading", { level: 2, name: "Traction", exact: true })).toBeVisible();
  await expect(
    detail.getByRole("group", { name: "Status" }).getByRole("button", { name: "Validated", pressed: true }),
  ).toBeVisible();
  await expect(detail.getByRole("heading", { name: "5.6.6 Sectionneur (S)" })).toBeVisible();
  await expect(detail.getByRole("img", { name: /Figure 40/ })).toBeVisible();
  await shoot(page, "documents");

  await rows.nth(1).click();
  await expect(page.getByRole("region", { name: "SOSIE_211_D401-1_4 details" })).toBeVisible();
});

test("the context note is edited and saved for Claude", async ({ page }) => {
  await boot(page, "#/documents");
  const detail = page.getByRole("region", { name: "SOSIE_211_D401-1_3 details" });
  const context = detail.getByRole("textbox", { name: "Note for this document" });
  await context.fill("Référence traction ligne 92. Les sectionneurs avec TK sont câblés depuis la v01.02.");
  await context.blur();
  await expect
    .poll(async () => JSON.stringify(await api(url, "docs.show", { id: "SOSIE_211_D401-1_3" })))
    .toContain("câblés depuis la v01.02");
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "SOSIE_211_D401-1_3 details" })
      .getByRole("textbox", { name: "Note for this document" }),
  ).toHaveValue(/câblés depuis la v01\.02/);
});

test("a document's status change is saved", async ({ page }) => {
  await boot(page, "#/documents");
  await page
    .getByRole("region", { name: "Document list" })
    .getByRole("row", { name: /^SOSIE_211_D401-1_4/ })
    .click();
  const detail = page.getByRole("region", { name: "SOSIE_211_D401-1_4 details" });
  const status = detail.getByRole("group", { name: "Status" });
  await status.getByRole("button", { name: "Validated" }).click();
  await expect(status.getByRole("button", { name: "Validated", pressed: true })).toBeVisible();
  await expect
    .poll(async () => JSON.stringify(await api(url, "docs.show", { id: "SOSIE_211_D401-1_4" })))
    .toContain('"status":"validated"');
});

test("a .docx added from a path is listed unconverted, then converted and indexed on demand", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "testimus-e2e-"));
  const file = join(dir, "SOSIE_211_D401-1_9.docx");
  writeFileSync(file, sampleDocx());
  await boot(page, "#/documents");
  await page.getByRole("button", { name: "Add from a path" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a document from a path" });
  await dialog.getByRole("textbox", { name: "Path of the file" }).fill(file);
  await dialog.getByRole("button", { name: "Add" }).click();
  await expect(dialog).toBeHidden();
  const rows = page.getByRole("region", { name: "Document list" }).getByRole("row", { name: /^SOSIE_/ });
  await expect(rows).toHaveCount(3, { timeout: 30_000 });
  const listed = JSON.stringify(await api(url, "docs.list"));
  const added = [...listed.matchAll(/"id":"([^"]+)"/g)]
    .map((m) => m[1])
    .find((id) => !id.startsWith("SOSIE_211_D401-1_3") && !id.startsWith("SOSIE_211_D401-1_4"));
  expect(added).toBeTruthy();
  const row = page
    .getByRole("region", { name: "Document list" })
    .getByRole("row", { name: new RegExp(`^${added} · `) });
  await expect(row).toHaveCount(1);
  await expect(row.getByText("Not converted")).toBeVisible();
  expect(JSON.stringify(await api(url, "docs.show", { id: added }))).not.toContain('"converted":');
  const side = page.getByRole("region", { name: `${added} details` });
  await expect(side.getByText("Not converted yet")).toBeVisible();
  await side.getByRole("button", { name: "Convert and index" }).click();
  await expect
    .poll(async () => JSON.stringify(await api(url, "docs.show", { id: added })), { timeout: 60_000 })
    .toContain('"converted":');
  await expect(side.getByRole("navigation", { name: "Sections" })).toBeVisible({ timeout: 30_000 });
});
