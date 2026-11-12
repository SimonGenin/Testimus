import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleDocx } from "../fixtures/docx/sample.ts";
import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const server = mockServer(4483);

test.use({ viewport: { width: 1920, height: 1080 } });

type Listed = { id: string; converted?: { at: string }; indexed: string }[];

type Job = { kind: string; subject: string };

test("a folder is read, its documents wait to start with what it takes, then each is converted and indexed", async ({
  page,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "testimus-e2e-folder-"));
  writeFileSync(join(dir, "SPEC_FA_01_00.docx"), sampleDocx());
  writeFileSync(join(dir, "SPEC_FB_01_00.docx"), sampleDocx());
  writeFileSync(join(dir, "SPEC_FC_01_00.docx"), sampleDocx());
  writeFileSync(join(dir, "~$EC_FA_01_00.docx"), "lock");
  writeFileSync(join(dir, "Notes.txt"), "notes");
  await boot(page, "#/documents");
  await page.getByRole("button", { name: "Import a folder…" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Import a folder" });
  await dialog.getByRole("textbox", { name: "Folder" }).fill(dir);
  await dialog.getByRole("button", { name: "Read the folder" }).click();
  await expect(
    dialog.getByText("5 files found (sub-folders included) · 4 can be imported · 1 left aside"),
  ).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "SPEC_FA_01_00.docx" })).toBeChecked();
  await expect(dialog.getByText("Word's lock file")).toBeVisible();
  await expect(dialog.getByRole("checkbox", { name: "Notes.txt" })).toBeChecked();
  await dialog.getByRole("checkbox", { name: "Notes.txt" }).uncheck();
  await shoot(page, "documents-import-folder-e2e");
  await dialog.getByRole("button", { name: "Import 3 documents" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("3 documents imported, waiting to start")).toBeVisible();

  const list = page.getByRole("region", { name: "Document list" });
  const batch = list.getByRole("region", { name: /3 documents waiting to start/ });
  await expect(batch).toBeVisible({ timeout: 30_000 });
  await expect(batch.getByText("3 Word")).toBeVisible();
  await expect(batch.getByText(/^\d+ KB · 3 files$/)).toBeVisible();
  await expect(batch.getByText(/^about .+ · estimated \(\d+ at a time\)$/)).toBeVisible();
  await expect(batch.getByText("About 3 runs")).toBeVisible();
  await expect(list.getByText("Waiting to start", { exact: true })).toHaveCount(3);
  const jobs = async () => (await api<Job[]>(server.url, "jobs.list")).filter((j) => j.kind === "docs.convert");
  expect(await jobs()).toEqual([]);
  await shoot(page, "documents-pending-e2e");

  await list.getByRole("option", { name: /SPEC_FC/ }).click();
  const side = page.getByRole("region", { name: "SPEC_FC details" });
  await side.getByRole("button", { name: "Remove" }).click();
  await expect(list.getByRole("option", { name: /SPEC_FC/ })).toHaveCount(0);
  expect((await api<Listed>(server.url, "docs.list")).some((d) => d.id === "SPEC_FC")).toBe(false);
  const project = (await api<{ dir: string }>(server.url, "project.info")).dir;
  expect(existsSync(join(project, "docs", "SPEC_FC"))).toBe(false);

  await list
    .getByRole("region", { name: /2 documents waiting to start/ })
    .getByRole("button", { name: "Start all" })
    .click();
  await expect
    .poll(async () => (await jobs()).map((j) => j.subject).sort(), { timeout: 30_000 })
    .toEqual(["SPEC_FA", "SPEC_FB"]);
  await expect
    .poll(
      async () =>
        (await api<Listed>(server.url, "docs.list"))
          .filter((d) => d.id.startsWith("SPEC_F"))
          .map((d) => `${d.id} ${d.converted ? "converted" : "-"} ${d.indexed}`),
      { timeout: 60_000 },
    )
    .toEqual(["SPEC_FA converted fresh", "SPEC_FB converted fresh"]);
  await expect(list.getByRole("option", { name: /SPEC_FA/ })).toContainText("Indexed");
});
