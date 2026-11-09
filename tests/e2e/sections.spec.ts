import type { Page } from "@playwright/test";
import { boot, expect, mockServer, test } from "./helpers.ts";

mockServer(4361);

const sectionOf = (page: Page, list: string) =>
  page.locator("[data-ws-section]", { has: page.getByRole("tablist", { name: list }) });

async function drag(page: Page, from: string, to: { x: number; y: number }) {
  const box = await page.getByRole("tab", { name: new RegExp(`^${from}`) }).boundingBox();
  if (!box) throw new Error(`no tab ${from}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
}

test("a tab dragged to the bottom of another section splits its column, and the layout is kept", async ({ page }) => {
  await boot(page, "#/jobs");
  const target = await sectionOf(page, "Section 2 · Job").boundingBox();
  if (!target) throw new Error("no Job section");
  await drag(page, "Jobs", { x: target.x + target.width / 2, y: target.y + target.height - 40 });
  await expect(page.getByRole("status").filter({ hasText: "Split: below" })).toBeVisible();
  await page.mouse.up();
  await expect(page.getByRole("tablist", { name: "Section 1 · Job", exact: true })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Section 1 · Jobs" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tablist", { name: "Section 1 · Jobs" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Sections of Jobs" })).toContainText("3/4");
});

test("a tab dropped among another section's tabs joins them, and Escape puts a drag back", async ({ page }) => {
  await boot(page, "#/jobs");
  const bar = await page.getByRole("tablist", { name: "Section 2 · Job", exact: true }).boundingBox();
  if (!bar) throw new Error("no Job tabs");
  await drag(page, "Jobs", { x: bar.x + bar.width - 10, y: bar.y + bar.height / 2 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByRole("tablist", { name: "Section 1 · Jobs" })).toBeVisible();
  await drag(page, "Jobs", { x: bar.x + bar.width - 10, y: bar.y + bar.height / 2 });
  await page.mouse.up();
  const tabs = page.getByRole("tablist", { name: /· Jobs$/ }).getByRole("tab");
  await expect(tabs).toHaveCount(2);
  await expect(page.getByRole("group", { name: "Sections of Jobs" })).toContainText("2/4");
});

test("the top bar adds a column that waits for a tab, drops it on Escape, and Reset brings the screen's own back", async ({
  page,
}) => {
  await boot(page, "#/jobs");
  const bar = page.getByRole("group", { name: "Sections of Jobs" });
  await expect(bar).toContainText("3/4");
  await bar.getByRole("button", { name: "Add column" }).click();
  await expect(bar).toContainText("4/4");
  await expect(bar.getByRole("button", { name: "Add column" })).toBeDisabled();
  const waiting = page.locator("[data-ws-section]").filter({ hasText: "Drag a tab here, or move one:" });
  await expect(waiting).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(waiting).toHaveCount(0);
  await expect(bar).toContainText("3/4");
  await bar.getByRole("button", { name: "Add column" }).click();
  await waiting.getByRole("button", { name: "Claude" }).click();
  await expect(page.getByRole("complementary", { name: "Claude" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: /· Claude$/ })).toBeVisible();
  await bar.getByRole("button", { name: "Layout menu" }).click();
  await page.getByRole("menuitem", { name: "Reset the layout of Jobs" }).click();
  await expect(page.getByRole("navigation", { name: "Section 3, collapsed" })).toBeVisible();
});

test("a section folds to its strip of icons, opens from it, and Alt Shift and an arrow send a tab", async ({
  page,
}) => {
  await boot(page, "#/jobs");
  await sectionOf(page, "Section 1 · Jobs").getByRole("button", { name: "Collapse this section" }).click();
  const strip = page.getByRole("navigation", { name: "Section 1, collapsed" });
  await expect(strip.getByRole("button", { name: /^Jobs/ })).toBeVisible();
  await strip.getByRole("button", { name: /^Jobs/ }).click();
  await expect(page.getByRole("tablist", { name: "Section 1 · Jobs" })).toBeVisible();
  await page.getByRole("tab", { name: /^Job$/ }).focus();
  await page.keyboard.press("Alt+Shift+ArrowRight");
  await expect(page.getByRole("tablist", { name: "Section 2 · Job", exact: true }).getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { name: /^Job$/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: /^Job$/ })).toBeFocused();
});

test("a narrow window folds the columns it cannot hold to their strip, never the work", async ({ page }) => {
  await page.setViewportSize({ width: 740, height: 800 });
  await boot(page, "#/jobs");
  await expect(page.getByRole("navigation", { name: "Section 1, collapsed" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Section 2 · Job", exact: true })).toBeVisible();
  const rail = page.getByRole("navigation", { name: "Main" });
  expect((await rail.boundingBox())?.width).toBeLessThanOrEqual(64);
});
