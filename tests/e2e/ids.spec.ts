import type { Locator, Page } from "@playwright/test";
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

  // ponytail: each job opens from the history of a test it was about — the three runs on LOCAL, the generation from a
  // test it wrote
  const opened = async (where: string, kind: string, also?: (panel: Locator) => Promise<void>) => {
    await page.goto(`/${where}`);
    const card = page.getByRole("region", { name: "History of the test" });
    const head = card.getByRole("button", { name: /History/ });
    if ((await head.getAttribute("aria-expanded")) !== "true") await head.click();
    await card
      .getByRole("option", { name: new RegExp(kind) })
      .first()
      .click();
    const panel = page.getByRole("dialog", { name: kind });
    await expect(panel).toBeVisible();
    await noLocalId(page, `the ${kind} job`);
    await panel.getByRole("button", { name: "Show the full log" }).click();
    await noLocalId(page, `the full log of the ${kind} job`);
    await also?.(panel);
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  };
  await opened(`#/review/${LOCAL}`, "Check tests");
  await opened(`#/review/${LOCAL}`, "Claude fix", (fix) =>
    expect(fix.getByText("Sectionneur avec TK — manœuvre régulière").first()).toBeVisible(),
  );
  await opened(`#/review/${LOCAL}`, "Claude request");
  await opened(`#/review/${written[0]}`, "Generate tests");

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
