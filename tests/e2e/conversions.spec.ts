import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleDocx } from "../fixtures/docx/sample.ts";
import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

// ponytail: every Claude run (the figures of each document) takes 6 s, so the conversions are seen while they go
const server = mockServer(4484, { TESTIMUS_MOCK_CLAUDE_MS: "6000" });

test.use({ viewport: { width: 1920, height: 1080 } });

type Job = { kind: string; status: string; startedAt: string };

test("several documents convert at once, the others wait their turn, then one index run", async ({ page }) => {
  await api(server.url, "system.set", { agentsMax: 2, agentsAdaptive: false });
  const dir = mkdtempSync(join(tmpdir(), "testimus-e2e-many-"));
  for (const n of ["MA", "MB", "MC", "MD"]) writeFileSync(join(dir, `SPEC_${n}_01_00.docx`), sampleDocx());
  const since = new Date().toISOString();
  await boot(page, "#/documents");
  await page.getByRole("button", { name: "Import a folder…" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Import a folder" });
  await dialog.getByRole("textbox", { name: "Folder" }).fill(dir);
  await dialog.getByRole("button", { name: "Read the folder" }).click();
  await dialog.getByRole("button", { name: "Import 4 documents" }).click();

  const list = page.getByRole("region", { name: "Document list" });
  await expect(list.getByText("Converting 2 at a time · 2 waiting · then one index run")).toBeVisible({
    timeout: 30_000,
  });
  await expect(list.getByRole("progressbar", { name: "Converting" })).toHaveCount(2);
  await expect(list.getByText("Waiting to convert")).toHaveCount(2);
  await shoot(page, "documents-converting-e2e");

  await expect(list.getByText(/Converting \d at a time/)).toHaveCount(0, { timeout: 90_000 });
  await expect
    .poll(
      async () => {
        const jobs = (await api<Job[]>(server.url, "jobs.list")).filter((j) => j.startedAt >= since);
        const converts = jobs.filter((j) => j.kind === "docs.convert");
        const index = jobs.filter((j) => j.kind === "rag-index");
        return `${converts.filter((j) => j.status === "done").length} converted, ${index.length} index run ${index.map((j) => j.status).join()}`;
      },
      { timeout: 90_000 },
    )
    .toBe("4 converted, 1 index run done");
});
