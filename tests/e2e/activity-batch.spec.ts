import { api, boot, expect, mockServer, shoot, test } from "./helpers.ts";

const server = mockServer(4361, { TESTIMUS_MOCK_JOBS: "100" });

test("the activity of a 100-conversion import fits the window: one line for the batch, its running ones on demand", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await boot(page, "#/documents");
  await page.getByRole("button", { name: /\d+ jobs running/ }).click();
  const pop = page.getByRole("dialog", { name: /^Running/ });
  const fold = pop.getByRole("button", { name: /100 conversions: 60 done, 10 running, 30 queued/ });
  await expect(fold).toBeVisible();
  await fold.click();
  await expect(pop.getByRole("button", { name: /^Convert document · SOSIE_211_D401-1_/ })).toHaveCount(10);
  const box = await pop.boundingBox();
  expect(box && box.y + box.height).toBeLessThanOrEqual(640);
  await shoot(page, "activity-batch");
  const parent = (await api<{ id: string; kind: string }[]>(server.url, "jobs.list", { running: true })).find(
    (j) => j.kind === "docs.add",
  );
  await api(server.url, "jobs.cancel", { id: parent?.id });
  await expect(page.getByRole("button", { name: /\d+ jobs running/ })).toHaveCount(0, { timeout: 15_000 });
});
