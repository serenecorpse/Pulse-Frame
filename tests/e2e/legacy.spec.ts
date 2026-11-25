import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

for (const name of ["lyrics", "motion", "upscaler"]) {
  test(`legacy ${name} browser tests remain runnable`, async ({ page }) => {
    await page.goto(
      pathToFileURL(resolve("legacy", "tests", `${name}.test.html`)).href,
    );
    await expect(page).toHaveTitle(
      new RegExp(`^PASS — Pulseframe ${name} tests$`),
    );
    await expect(page.locator("#summary")).toContainText("0 failed");
  });
}
