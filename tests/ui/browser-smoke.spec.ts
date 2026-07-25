import { expect, test } from "@playwright/test";

import { establishDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

test("keeps the authenticated shell, keyboard navigation, and table layout usable", async ({ context, page }) => {
  await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  await page.goto("/");

  const episodes = page.getByRole("navigation").getByRole("link", { name: "Episodes", exact: true });
  await episodes.focus();
  await expect(episodes).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/episodes$/);
  await expect(page.getByRole("heading", { name: "Episodes" })).toBeVisible();

  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
});
