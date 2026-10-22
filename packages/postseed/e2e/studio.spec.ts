import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { TOKEN } from "./global-setup";

const dbUrl = (): string => process.env.E2E_DATABASE_URL as string;

async function count(table: string): Promise<number> {
  const c = new pg.Client({ connectionString: dbUrl() });
  await c.connect();
  try {
    return Number((await c.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
  } finally {
    await c.end();
  }
}

async function open(page: Page): Promise<void> {
  await page.goto(`/?t=${TOKEN}`);
  await expect(page.getByRole("heading", { name: "Connect to a database" })).toBeVisible();
}

async function connect(page: Page): Promise<void> {
  await page.getByLabel("Connection string").fill(dbUrl().replace(/^postgres:\/\//, ""));
  await page.getByLabel("Save as").fill("E2E shop");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
}

async function a11y(page: Page, label: string, skip: string[] = []): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).disableRules(skip).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), `axe violations on ${label}`).toEqual([]);
}

test.describe.configure({ mode: "serial" });

test("the link token is required, then dropped from the URL", async ({ page, request }) => {
  const denied = await request.get("/", { maxRedirects: 0 });
  expect(denied.status()).toBe(403);
  await open(page);
  expect(page.url()).not.toContain("t=");
  await page.screenshot({ path: "e2e/__screens__/01-connect.png" });
  await a11y(page, "connect");
});

test("connect → select → generate → dry run → insert → verify → history", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4377") && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url());
  });
  await open(page);
  await connect(page);
  await expect(page.getByText("Tables · 8")).toBeVisible();

  await page.locator("#rows-input").fill("25");
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  const output = page.getByRole("region", { name: "Generated output" });
  await expect(output).toContainText("INSERT INTO public.products");
  await expect(page.getByText("Deterministic · seed 42")).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/02-studio.png" });
  await a11y(page, "studio");

  // Seed 42 twice gives identical text.
  const first = await output.innerText();
  await page.getByRole("button", { name: "Generate", exact: true }).click();
  await expect(output).toContainText("INSERT INTO public.products");
  expect(await output.innerText()).toBe(first);

  await page.getByRole("button", { name: /Insert into DB/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Insert 200 rows into e2e?");
  await page.screenshot({ path: "e2e/__screens__/03-insert-confirm.png" });
  await a11y(page, "insert dialog");

  // Truncate stays disabled until the database name is typed.
  await dialog.getByLabel(/TRUNCATE/).check();
  await expect(dialog.getByRole("button", { name: "Insert 200 rows" })).toBeDisabled();
  await dialog.getByLabel(/Type e2e/).fill("e2e");
  await expect(dialog.getByRole("button", { name: "Insert 200 rows" })).toBeEnabled();
  await dialog.getByLabel(/TRUNCATE/).uncheck();

  await dialog.getByRole("button", { name: "Dry run" }).click();
  await expect(page.getByRole("heading", { name: /Dry run passed/ })).toBeVisible();
  expect(await count("users")).toBe(0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: "e2e/__screens__/04-dry-run.png" });

  await page.getByRole("button", { name: "Run the real insert" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Insert 200 rows" }).click();
  await expect(page.getByRole("heading", { name: /Inserted 200 rows/ })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "e2e/__screens__/05-success.png" });
  await a11y(page, "success");
  for (const t of ["users", "customers", "products", "orders", "order_items", "payments", "shipments", "inventory"]) {
    expect(await count(t), t).toBe(25);
  }

  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByRole("cell", { name: "Inserted" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Dry run" })).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/06-history.png" });
  await a11y(page, "history");
  await page.getByRole("button", { name: "Re-run with same seed" }).first().click();
  await expect(page.getByRole("tab", { name: "Tables" })).toHaveAttribute("aria-selected", "true");
  expect(external, "no request left this machine").toEqual([]);
});

test("a reload keeps the connection, and a missing parent table is explained", async ({ page }) => {
  await page.goto(`/?t=${TOKEN}`);
  await expect(page.getByText("Connected", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: /customers/ }).uncheck();
  await expect(page.getByText("references")).toBeVisible();
  await expect(page.getByText(/using 25 existing rows/)).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/07-missing-parent.png" });
  await page.getByRole("button", { name: "Add customers" }).click();
  await expect(page.getByRole("checkbox", { name: /customers/ })).toBeChecked();
});

test("the command palette, theme and format controls work from the keyboard", async ({ page }) => {
  await page.goto(`/?t=${TOKEN}`);
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Type a command/).fill("format json");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("radio", { name: "JSON" })).toBeChecked();
  await page.getByRole("radio", { name: "SQL" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: /Switch to light theme/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.waitForTimeout(400);
  await page.screenshot({ path: "e2e/__screens__/08-light.png" });
  await a11y(page, "studio (light)");
  await page.getByRole("button", { name: /Switch to dark theme/ }).click();
});

test("templates work without a database and without leaving the page", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4377") && !r.url().startsWith("data:") && !r.url().startsWith("blob:")) external.push(r.url());
  });
  await page.goto(`/?t=${TOKEN}`);
  await page.getByRole("tab", { name: "Templates" }).click();
  await expect(page.getByRole("heading", { name: "Templates" })).toBeVisible();
  await page.screenshot({ path: "e2e/__screens__/09-templates.png" });
  await a11y(page, "templates");
  await page.getByRole("button", { name: /Fintech ledger/ }).click();
  await expect(page.getByRole("region", { name: "Generated output" })).toContainText("INSERT INTO public.customers");
  await page.screenshot({ path: "e2e/__screens__/10-template-workbench.png" });
  // CodeMirror's scroller is not itself tabbable, but the editable text inside it is (and scrolls with the caret),
  // so axe's scrollable-region-focusable is a known false positive for the editor.
  await a11y(page, "template workbench", ["scrollable-region-focusable"]);
  expect(external).toEqual([]);
});

test("docs render and the server-stopped banner appears when the server goes away", async ({ page }) => {
  await page.goto(`/?t=${TOKEN}`);
  await page.getByRole("tab", { name: "Docs" }).click();
  await expect(page.getByRole("heading", { name: "How a run works" })).toBeVisible();
  await a11y(page, "docs");
  await page.route("**/api/health", (route) => route.abort());
  await expect(page.getByText("Studio's server has stopped")).toBeVisible({ timeout: 15_000 });
});
