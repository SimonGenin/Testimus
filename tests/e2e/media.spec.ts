import { join } from "node:path";
import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const { url } = mockServer(4366);
const D3 = "SOSIE_211_D401-1_3";
const FILES = join(import.meta.dirname, "..", "fixtures", "project", "docs", D3, "media", "recette-tco-12-10", "files");

test.use({ viewport: { width: 1920, height: 1080 } });

type Batch = { id: string; title: string; included: boolean; photos: number; analysed: number; state: string };

test("a batch is added from its dialog, read by Claude, and becomes an annex of the document", async ({ page }) => {
  await boot(page, `#/documents/${D3}`);
  const detail = page.getByRole("region", { name: `${D3} details` });
  const side = detail.getByRole("complementary", { name: "Document settings" });
  await expect(side.getByRole("list", { name: "Photos and videos" })).toContainText("Recette TCO 12/10");

  await side.getByRole("button", { name: "Add photos & videos…" }).click();
  const dialog = page.getByRole("dialog", { name: "Add photos & videos" });
  await expect(dialog.getByRole("button", { name: "Add the batch" })).toBeDisabled();
  const chooser = page.waitForEvent("filechooser");
  await dialog.getByRole("button", { name: "Choose photos…" }).click();
  await (await chooser).setFiles([join(FILES, "IMG_0042.jpg"), join(FILES, "IMG_0043.jpg")]);
  await expect(dialog.getByRole("list", { name: "Files of the batch" }).getByRole("listitem")).toHaveCount(2);
  await dialog.getByRole("textbox", { name: "Title" }).fill("Essai ouverture");
  await dialog.getByRole("textbox", { name: "Context" }).fill("Photos du TCO réel, version 3.2.");
  await shoot(page, "media-dialog");
  await dialog.getByRole("button", { name: "Add the 2 photos" }).click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(async () => (await api<Batch[]>(url, "media.list", { doc: D3 })).find((b) => b.title === "Essai ouverture"))
    .toMatchObject({ included: true, photos: 2, analysed: 2, state: "ready" });
  const lists = page.getByRole("region", { name: "Document list" });
  await expect(lists.getByRole("option", { name: new RegExp(D3) })).toContainText("Essai ouverture — 2 photos");

  await side.getByRole("button", { name: "Open Essai ouverture" }).click();
  const batch = page.getByRole("dialog", { name: "Essai ouverture" });
  const photos = batch.getByRole("list", { name: "Photos of the batch" }).getByRole("listitem");
  await expect(photos).toHaveCount(2);
  await expect(photos.first()).toContainText("Photo simulée de IMG_0042.jpg");
  await expect(photos.first()).toContainText("Illustrates §5.6.6");
  await shoot(page, "media-batch");
  await photos.first().getByRole("button", { name: "In the annex" }).click();

  await expect(detail.getByText("Observed on the real system")).toBeVisible();
  await expect(detail.getByRole("heading", { name: "IMG_0042" })).toBeVisible();
  await expect(detail.getByRole("img", { name: /IMG_0042\.jpg/ })).toBeVisible();
  await expect(detail.getByRole("navigation", { name: "Sections" })).toContainText("Annexes · observed");
  await shoot(page, "media-annex");
});

test("the fixture's batch is put in the document and taken out by its checkbox", async ({ page }) => {
  await boot(page, `#/documents/${D3}`);
  const side = page.getByRole("complementary", { name: "Document settings" });
  const box = side.getByRole("checkbox", { name: /Recette TCO 12\/10/ });
  await expect(box).not.toBeChecked();
  await box.click();
  await expect
    .poll(async () => (await api<Batch[]>(url, "media.list", { doc: D3 })).find((b) => b.id === "recette-tco-12-10"))
    .toMatchObject({ included: true });
  await expect(box).toBeChecked();
  const toc = page.getByRole("navigation", { name: "Sections" });
  await expect(toc).toContainText("Annexe — Recette TCO 12/10");
  await box.click();
  await expect(box).not.toBeChecked();
  await expect(toc).not.toContainText("Annexe — Recette TCO 12/10");
});

test("the generation scope lists a document's annexes, each one left out on its own", async ({ page }) => {
  const jobs = await api<{ jobId: string }>(url, "media.include", {
    doc: D3,
    lot: "recette-tco-12-10",
    included: true,
  });
  expect(jobs.jobId).toBeTruthy();
  await expect.poll(async () => (await api<Batch[]>(url, "media.list", { doc: D3 }))[0]?.included).toBe(true);
  await boot(page, "#/generate");
  const annexes = page.getByRole("list", { name: "Annexes in scope" });
  const annex = annexes.getByRole("checkbox", { name: "Annex — Recette TCO 12/10" });
  await expect(annex).toBeChecked();
  await annex.click();
  await expect(page.getByRole("list", { name: "Documents in scope" })).toContainText(/[0-9] sections? picked/);
  await shoot(page, "media-scope");
});
