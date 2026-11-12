import type { Page } from "@playwright/test";
import { api, boot, expect, mockServer, test, waitForJob } from "./helpers.ts";

const server = mockServer(4430);

const LOCAL_ID = /\blocal-[0-9a-f]{6,}\b/;
const LOCAL = "local-3f9a12c0";
const DOC = "SOSIE_211_D401-1_3";

// ponytail: what a person reads on the page (innerText) — the folded « Technical details », where an id may stay, is
// not visible
async function noLocalId(page: Page, where: string): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.locator("body"), `no local test id on ${where}`).not.toContainText(LOCAL_ID, {
    useInnerText: true,
  });
}

test("no internal id on the main screens, once Claude has checked, fixed, edited and written tests", async ({
  page,
}) => {
  test.setTimeout(240_000);
  let written: string[] = [];
  for (const [name, input] of [
    ["check.run", { ids: [LOCAL] }],
    ["review.fix", { id: LOCAL }],
    ["claude.run", { scope: { kind: "test", testId: LOCAL }, prompt: "Rends le step 2 plus clair" }],
    ["gen.tests", { request: "Tests du sectionneur", docs: [DOC] }],
  ] as const) {
    const { jobId } = await api<{ jobId: string }>(server.url, name, input);
    const result = await waitForJob<{ tests?: string[] }>(server.url, jobId);
    if (name === "gen.tests") written = result?.tests ?? [];
  }
  expect(written.length).toBeGreaterThan(0);

  await boot(page, "#/tests");
  for (const hash of [
    "#/documents",
    `#/documents/${DOC}`,
    "#/generate",
    "#/tests",
    "#/tests/LFRPS12-1398",
    "#/review",
    `#/review/${LOCAL}`,
    "#/settings/project",
    "#/settings/claude",
  ]) {
    await page.goto(`/${hash}`);
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await noLocalId(page, hash);
  }

  await page.goto(`/#/review/${LOCAL}`);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("sectionneur");
  await expect(page.getByRole("dialog").getByRole("option").first()).toBeVisible();
  await noLocalId(page, "the palette");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+j");
  await expect(page.getByRole("complementary", { name: "Claude" })).toBeVisible();
  await noLocalId(page, "the Claude dock");
});
