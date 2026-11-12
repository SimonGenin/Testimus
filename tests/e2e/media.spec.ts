import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { boot, expect, mockServer, shoot, test } from "./helpers.ts";

mockServer(4366);
const DOCS = join(import.meta.dirname, "..", "fixtures", "project", "docs");
const PHOTOS = join(DOCS, "RECETTE_TCO_12-10", "files");
const FILM = join(DOCS, "Manoeuvre_d_un_sectionneur_au_PCC", "files", "manoeuvre.mp4");

test.use({ viewport: { width: 1920, height: 1080 } });

const pick = async (page: import("@playwright/test").Page, files: string[]) => {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add documents" }).first().click();
  await (await chooser).setFiles(files);
};

test("images picked together become one document, observed, prepared and read, shown as a grid", async ({ page }) => {
  await boot(page, "#/documents");
  await pick(page, [join(PHOTOS, "IMG_0042.jpg"), join(PHOTOS, "IMG_0043.jpg")]);
  const dialog = page.getByRole("dialog", { name: "Add 2 images" });
  await expect(dialog.getByRole("radio", { name: /One document with the 2 images/ })).toBeChecked();
  await dialog.getByRole("textbox", { name: "Title" }).fill("Visite du PCC");
  await shoot(page, "media-add-images");
  await dialog.getByRole("button", { name: "Add one document" }).click();

  const list = page.getByRole("region", { name: "Document list" });
  const row = list.getByRole("option", { name: /Visite du PCC/ });
  await expect(row).toContainText("Images · 2");
  await expect(row).toContainText("Observed");
  await row.click();
  await page.getByRole("button", { name: "Prepare and read" }).click();
  const grid = page.getByRole("list", { name: "Images" });
  await expect(grid.getByRole("listitem")).toHaveCount(2, { timeout: 20_000 });
  await expect(grid).toContainText("img:1");
  await expect(grid).toContainText("Image simulée de IMG_0042.jpg");
  await expect(page.getByRole("tab", { name: /Images/ })).toHaveAttribute("aria-selected", "true");
  await grid.getByRole("button", { name: /img:2/ }).click();
  const large = page.getByRole("dialog", { name: "IMG_0043.jpg" });
  await expect(large.getByText(/#img:2$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(large).toBeHidden();
});

test("a video becomes a document: transcribed, surveyed, its transcript goes to a moment", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "testimus-film-"));
  const film = join(dir, "essai PCC.mp4");
  copyFileSync(FILM, film);
  await boot(page, "#/documents");
  await pick(page, [film]);
  const row = page.getByRole("region", { name: "Document list" }).getByRole("option", { name: /essai PCC/ });
  await expect(row).toContainText("Video");
  await expect(row).toContainText("Observed");
  await row.click();
  await page.getByRole("button", { name: "Prepare and read" }).click();
  const transcript = page.getByRole("list", { name: "What is said" });
  await expect(transcript.getByRole("button", { name: /^\d\d:\d\d$/ })).toHaveCount(11, { timeout: 30_000 });
  await expect(row).toContainText("Video · 02:40");
  await transcript.getByRole("button", { name: "00:32", exact: true }).click();
  await expect(transcript.locator('li[aria-current="true"]')).toContainText("clic droit sur le sectionneur");
  const at = await page.getByLabel("Video essai PCC.mp4").evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(at).toBe(32);
  await expect(transcript.getByRole("button", { name: /Refus de manœuvre/ })).toBeVisible();
  await expect(transcript.getByText("Unsure")).toHaveCount(1);
  await expect(transcript.getByText(/DE · Bon, refermez maintenant/)).toBeVisible();
  await expect(page.getByRole("list", { name: "Key frames" }).getByRole("listitem")).toHaveCount(4);
});

test("the fixture's video opens at a moment a source names", async ({ page }) => {
  await boot(page, "#/documents/Manoeuvre_d_un_sectionneur_au_PCC#t:00:47");
  const transcript = page.getByRole("list", { name: "What is said" });
  await expect(transcript.locator('li[aria-current="true"]')).toContainText("La fenêtre Propriétés");
  await shoot(page, "media-video");
});

test("a recording of sound alone becomes a document: heard, with no picture nor key frame", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "testimus-sound-"));
  const memo = join(dir, "reunion traction.mp3");
  writeFileSync(memo, JSON.stringify({ duration: 130 }));
  await boot(page, "#/documents");
  await pick(page, [memo]);
  const row = page.getByRole("region", { name: "Document list" }).getByRole("option", { name: /reunion traction/ });
  await row.click();
  await expect(page.getByText(/What is said goes to Claude in its runs/)).toBeVisible();
  await page.getByRole("button", { name: "Prepare and read" }).click();
  const transcript = page.getByRole("list", { name: "What is said" });
  await expect(transcript.getByRole("button", { name: /^\d\d:\d\d$/ }).first()).toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText("Sound · 02:10");
  await expect(page.getByText("Sound only")).toBeVisible();
  await expect(page.getByRole("list", { name: "Key frames" }).getByRole("listitem")).toHaveCount(0);
});

test("tests are generated from an images document like from any other", async ({ page }) => {
  await boot(page, "#/generate");
  const request = page.getByRole("region", { name: "Request" });
  const result = page.getByRole("region", { name: "Result" });
  await request.getByRole("checkbox", { name: "Review the plan before writing" }).uncheck();
  await request.getByRole("button", { name: "Narrow…" }).click();
  const docs = request.getByRole("list", { name: "Documents in scope" });
  await request.getByRole("button", { name: "Select none" }).click();
  for (let more = docs.getByRole("button", { name: /^Unfold/ }); await more.count(); ) await more.first().click();
  await docs.getByRole("checkbox", { name: /Recette TCO 12\/10/ }).check();
  await request.getByRole("textbox", { name: "What should be tested?" }).fill("Le menu contextuel du sectionneur S12");
  await request.getByRole("button", { name: "Generate" }).click();
  const replace = page.getByRole("alertdialog", { name: /before generating\?$/ });
  if (await replace.isVisible({ timeout: 2000 }).catch(() => false))
    await replace.getByRole("button", { name: "Delete and generate" }).click();
  await expect(result.getByRole("heading", { name: /tests? written/ })).toBeVisible({ timeout: 30_000 });
});
