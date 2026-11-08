import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleDocx } from "../fixtures/docx/sample.ts";
import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const server = mockServer(4483);

test.use({ viewport: { width: 1920, height: 1080 } });

type Listed = { id: string; converted?: { at: string }; indexed: string }[];

test("a folder is read, its documents imported, each converted then indexed", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "testimus-e2e-folder-"));
  writeFileSync(join(dir, "SPEC_FA_01_00.docx"), sampleDocx());
  writeFileSync(join(dir, "SPEC_FB_01_00.docx"), sampleDocx());
  writeFileSync(join(dir, "~$EC_FA_01_00.docx"), "lock");
  writeFileSync(join(dir, "Notes.txt"), "notes");
  await boot(page, "#/documents");
  await page.getByRole("button", { name: "Import a folder…" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Import a folder" });
  await dialog.getByRole("textbox", { name: "Folder" }).fill(dir);
  await dialog.getByRole("button", { name: "Read the folder" }).click();
  await expect(
    dialog.getByText("4 files found (sub-folders included) · 2 can be imported · 2 left aside"),
  ).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "SPEC_FA_01_00.docx" })).toBeChecked();
  await expect(dialog.getByText("Word's lock file")).toBeVisible();
  await expect(dialog.getByText("Testimus cannot convert .txt files yet")).toBeVisible();
  await shoot(page, "documents-import-folder-e2e");
  await dialog.getByRole("button", { name: "Import 2 documents" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Importing 2 documents — started")).toBeVisible();

  const list = page.getByRole("region", { name: "Document list" });
  await expect(list.getByRole("option", { name: /SPEC_FA/ })).toHaveCount(1, { timeout: 30_000 });
  await expect(list.getByRole("option", { name: /SPEC_FB/ })).toHaveCount(1);
  await expect
    .poll(
      async () =>
        (await api<Listed>(server.url, "docs.list"))
          .filter((d) => d.id.startsWith("SPEC_F"))
          .map((d) => `${d.id} ${d.converted ? "converted" : "-"} ${d.indexed}`),
      { timeout: 60_000 },
    )
    .toEqual(["SPEC_FA converted fresh", "SPEC_FB converted fresh"]);
});
