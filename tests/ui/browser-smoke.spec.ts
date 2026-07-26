import { expect, test } from "@playwright/test";

import { establishDebugSession } from "../fixtures/debug-session";

const COPPERLINE_ORGANIZATION_ID = "10000000-0000-4000-8000-000000000005";

test("keeps the authenticated shell, keyboard navigation, and show workspace usable", async ({ context, page }) => {
  await establishDebugSession(context, "user_maya", COPPERLINE_ORGANIZATION_ID);
  await page.goto("/");

  const shows = page.getByRole("navigation").getByRole("link", { name: "Shows", exact: true });
  await shows.focus();
  await expect(shows).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/shows$/);
  await expect(page.getByRole("heading", { name: "Shows" })).toBeVisible();

  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
});
