import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const ORIGIN = "http://127.0.0.1:4378";

async function a11y(page: Page, label: string, skip: string[] = []): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).disableRules(skip).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), `axe violations on ${label}`).toEqual([]);
}

test("the landing page says what Postseed is and works without any external request", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith(ORIGIN) && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url());
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Realistic Postgres seed data. In seconds.");
  await expect(page.getByText("never leaves your machine")).toBeVisible();
  for (const chip of ["Postgres 15–18", "FK-aware", "Local-first", "Deterministic"]) await expect(page.getByRole("list", { name: "Highlights" }).getByText(chip, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Copy command: npx postseed/ })).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/web-01-hero.png" });
  await a11y(page, "landing");

  // The Playground generates real data in a Web Worker.
  await page.getByRole("link", { name: /Try with example/ }).click();
  const output = page.getByRole("region", { name: "Generated output" });
  await expect(output).toContainText("INSERT INTO public.users", { timeout: 30_000 });
  await expect(page.getByText(/seed 42/).first()).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/web-02-playground.png" });
  await a11y(page, "landing with playground", ["scrollable-region-focusable"]);

  // Switching examples regenerates; the output is deterministic.
  await page.getByRole("button", { name: "Fintech ledger" }).click();
  await expect(output).toContainText("INSERT INTO public.customers", { timeout: 30_000 });
  expect(external, "no request left this machine").toEqual([]);
});

test("the Playground edits, regenerates and downloads", async ({ page }) => {
  await page.goto("/#playground");
  const output = page.getByRole("region", { name: "Generated output" });
  await expect(output).toContainText("INSERT INTO", { timeout: 30_000 });
  const editor = page.getByRole("textbox", { name: "Schema" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("CREATE TABLE pets (id serial PRIMARY KEY, name text NOT NULL, owner_email text UNIQUE);");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(output).toContainText("INSERT INTO public.pets", { timeout: 30_000 });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Download \.sql/ }).click();
  expect((await download).suggestedFilename()).toBe("seed-42.sql");
  // A broken schema is explained, not a crash.
  await editor.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("this is not sql");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(page.getByText("Could not generate")).toBeVisible();
});

test("the same seed gives the same Playground output twice", async ({ page }) => {
  await page.goto("/#playground");
  const output = page.getByRole("region", { name: "Generated output" });
  await expect(output).toContainText("INSERT INTO", { timeout: 30_000 });
  const first = await output.innerText();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(output).toContainText("INSERT INTO");
  expect(await output.innerText()).toBe(first);
});

for (const slug of ["quickstart", "config", "determinism", "security-model", "faq"]) {
  test(`docs: ${slug} renders and is accessible`, async ({ page }) => {
    await page.goto(`/docs/${slug}/`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Documentation" })).toBeVisible();
    await a11y(page, `docs/${slug}`);
  });
}

test("docs links between pages resolve", async ({ page, request }) => {
  await page.goto("/docs/quickstart/");
  const hrefs = await page.locator("article a[href^='/docs/']").evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const h of new Set(hrefs)) expect((await request.get(h)).status(), h).toBe(200);
});

test("light theme is accessible and persists across a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Switch to light theme/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.screenshot({ path: "e2e/__screens__/web-03-light.png" });
  await a11y(page, "landing (light)");
});

test("the layout fits a phone with no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/docs/config/", "/docs/faq/"]) {
    await page.goto(path);
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `horizontal overflow on ${path}`).toBeLessThanOrEqual(1);
  }
  await page.goto("/");
  await page.screenshot({ path: "e2e/__screens__/web-04-mobile.png" });
});

test("an unknown page gets a helpful 404", async ({ page }) => {
  const res = await page.goto("/nope/");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
});
