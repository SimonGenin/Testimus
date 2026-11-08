import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { boot, expect, mockServer, SCREENS_DIR, setTheme, test } from "./helpers.ts";

mockServer(4398);

test("the kit lists every component by family, and filters by name", async ({ page }) => {
  await boot(page, "#/kit");
  const nav = page.getByRole("navigation", { name: "Components" });
  await expect(nav.getByRole("option", { name: /^Button/ })).toBeVisible();
  await expect(nav.getByRole("group", { name: "Claude" }).getByRole("option", { name: /^ClaudeBlock/ })).toBeVisible();
  await page.getByRole("textbox", { name: "Filter components" }).fill("cla");
  await expect(nav.getByRole("option", { name: /^ClaudeBlock/ })).toBeVisible();
  await expect(nav.getByRole("option", { name: /^Button/ })).toHaveCount(0);
  await expect(nav).toContainText(/1 of \d+ components match/);
  await page.getByRole("textbox", { name: "Filter components" }).fill("zzz");
  await expect(nav).toContainText("No component named « zzz »");
});

test("each component page shows its props and every state, light and dark, styled by the tokens", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 3600 });
  await page.emulateMedia({ colorScheme: "light" });
  await boot(page, "#/kit");
  await setTheme(page, "light");
  mkdirSync(join(SCREENS_DIR, "kit"), { recursive: true });
  const rows = page.getByRole("navigation", { name: "Components" }).getByRole("option");
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(7);
  for (let i = 0; i < count; i++) {
    await rows.nth(i).click();
    const name =
      (await page.getByRole("main", { name: "Component" }).getByRole("heading", { level: 1 }).textContent())?.trim() ??
      "";
    expect((await rows.nth(i).textContent())?.startsWith(name)).toBe(true);
    await expect(page.getByRole("banner").getByRole("heading", { level: 1 })).toContainText(name);
    await expect(page).toHaveURL(new RegExp(`#/kit/${name}$`));
    const props = page.getByRole("region", { name: "Props" });
    await expect(props.locator("span").first()).toBeVisible();
    const light = page.getByRole("region", { name: `${name}, Light` });
    const dark = page.getByRole("region", { name: `${name}, Dark` });
    await expect(light).toBeVisible();
    await expect(dark).toBeVisible();
    const bg = (r: typeof light) => r.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await bg(light)).toBe("rgb(247, 247, 248)");
    expect(await bg(dark)).toBe("rgb(14, 14, 16)");
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(SCREENS_DIR, "kit", `${name}.png`), animations: "disabled" });
  }
});

test("the page follows the explicit theme and the system one", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await boot(page, "#/kit/Button");
  const primary = page.getByRole("region", { name: "Props" });
  await expect(primary).toBeVisible();
  const canvas = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  await setTheme(page, "light");
  expect(await canvas()).toBe("rgb(247, 247, 248)");
  await setTheme(page, "dark");
  await expect.poll(canvas).toBe("rgb(14, 14, 16)");
  await setTheme(page, "system");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(canvas).toBe("rgb(14, 14, 16)");
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(canvas).toBe("rgb(247, 247, 248)");
});

test("a card that folds opens and folds its body from its head", async ({ page }) => {
  await boot(page, "#/kit/Card");
  const light = page.getByRole("region", { name: "Card, Light" });
  const head = light.getByRole("button", { name: /^Sectionneur sans TK — menu contextuel/ });
  await expect(head).toHaveAttribute("aria-expanded", "false");
  await expect(light.getByText("4 steps.")).toHaveCount(0);
  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  await expect(light.getByText("4 steps.")).toBeVisible();
  await expect(light.getByRole("button", { name: /^Sectionneur avec TK/ })).toHaveAttribute("aria-expanded", "true");
});

test("the Video component plays a project video through /files, which answers byte ranges", async ({ page }) => {
  await boot(page, "#/kit/Video");
  const light = page.getByRole("region", { name: "Video, Light" });
  const player = light.getByLabel("Video manoeuvre.mp4", { exact: true });
  await expect(player).toBeVisible();
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => Math.round(v.duration))).toBe(160);
  await expect(light.getByLabel("Video manoeuvre.mp4 at 01:20")).toHaveAttribute("src", /#t=80$/);
});
