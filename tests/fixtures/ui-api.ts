import type { Page } from "@playwright/test";

/**
 * Intercept a single browser-side FastAPI write. Page content continues to
 * come from the local FastAPI service; this helper only makes destructive UI
 * controls repeatable while the authoritative Python suite owns persistence
 * and lifecycle assertions.
 */
export async function captureJsonWrite(
  page: Page,
  url: string | RegExp,
  response: unknown = { ok: true },
  status = 200,
) {
  let body: unknown;
  await page.route(url, async (route) => {
    // A mutation can refresh its client-side resource afterwards. Preserve
    // that real GET response rather than replacing it with a write fixture.
    if (route.request().method() === "GET") return route.continue();
    body = route.request().postDataJSON();
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  });
  return () => body;
}

export async function captureJsonError(page: Page, url: string | RegExp, detail: string, status = 409) {
  return captureJsonWrite(page, url, { detail }, status);
}
