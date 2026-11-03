import { boot, expect, mockServer, openDock, openTest, shoot, test } from "./helpers.ts";

test.describe("Claude not installed", () => {
  mockServer(4344, { TESTIMUS_MOCK_CLAUDE: "absent" });

  test("the dock shows a calm install panel and the editor still works", async ({ page }) => {
    await openTest(page, "LFRPS12-1420");
    const dock = await openDock(page);
    await expect(dock.getByRole("heading", { name: "Claude isn't installed on this PC yet" })).toBeVisible();
    await expect(dock.getByText(/Everything else — editing, review, push — works now/)).toBeVisible();
    await expect(dock.getByRole("button", { name: /^Copy: / }).first()).toBeVisible();
    await expect(dock.getByRole("button", { name: "Check again" })).toBeEnabled();
    await expect(page.getByRole("main").getByRole("textbox", { name: "Summary" })).toBeEditable();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await shoot(page, "dock-claude-absent");
    await dock.getByRole("button", { name: "Open system check" }).click();
    await expect(page).toHaveURL(/#\/doctor$/);
  });
});

test.describe("Claude signed out", () => {
  mockServer(4345, { TESTIMUS_MOCK_CLAUDE: "logged-out" });

  test("a question to the documents says Claude is not signed in and how to fix it", async ({ page }) => {
    await boot(page, "#/documents");
    const dock = await openDock(page);
    await dock.getByRole("tab", { name: "Ask the documents" }).click();
    await dock.getByRole("textbox", { name: "Ask the documents" }).fill("Que propose le menu ?");
    await dock.getByRole("button", { name: "Send" }).click();
    await expect(
      dock
        .getByText("Claude Code is not signed in.")
        .or(dock.getByRole("heading", { name: "Claude isn't signed in on this PC yet" })),
    ).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
});
