/**
 * `bun run check:screens`: checks the screens in a real browser.
 * Builds (if needed) and starts the app against its own temporary database
 * (migrated and seeded fresh, so your data/ffcc.db is never touched), signs
 * in with the dev login, and opens every area at phone and desktop widths.
 * For each one it checks the page loads, the navigation and heading show, and
 * nothing scrolls sideways. Then it runs a CSV import end to end: upload,
 * auto-detect, preview, import, Activity, re-import (nothing new) and undo.
 * Screenshots go to screenshots/.
 *
 * Uses Chromium from PLAYWRIGHT_BROWSERS_PATH or CHROMIUM_PATH if set.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { SESSION_COOKIE, signSession } from "@/auth/token";
import { createDb } from "@/db";
import { runMigrations } from "@/db/migrate";
import { ukDate } from "@/lib/time";
import { MockAiProvider } from "@/ai";
import { runEngine } from "@/engine/run";
import { seedDatabase } from "@/seed";

const PORT = Number(process.env.CHECK_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;
const AREAS = [
  { path: "/", heading: "Home", nav: "Home" },
  { path: "/activity", heading: "Activity", nav: "Activity" },
  { path: "/plan", heading: "Plan", nav: "Plan" },
  { path: "/reports", heading: "Reports", nav: "Reports" },
  { path: "/settings", heading: "Settings", nav: "Settings" },
  { path: "/settings/import", heading: "Import a bank statement", nav: "Settings" },
  { path: "/settings/imports", heading: "Past imports", nav: "Settings" },
] as const;
const FIXTURE = "fixtures/csv/nationwide-style-joint-2026-01-to-03.csv";
const VIEWPORTS = [
  { name: "phone-320", width: 320, height: 640, screenshot: false },
  { name: "phone", width: 375, height: 812, screenshot: true },
  { name: "desktop", width: 1280, height: 860, screenshot: true },
] as const;

function chromiumPath(): string | undefined {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const candidate = "/opt/pw-browsers/chromium";
  return existsSync(candidate) ? candidate : undefined;
}

async function waitForServer(url: string, timeoutMs = 60_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Server did not start at ${url}`);
}

async function shot(page: Page, name: string) {
  const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  const { width, height } = page.viewportSize()!;
  await page.setViewportSize({ width, height: Math.max(height, fullHeight) });
  await page.screenshot({ path: `screenshots/${name}.png` });
  await page.setViewportSize({ width, height });
}

/** Steps 1–3 of the wizard for the sample Nationwide-style file. */
async function uploadAndPreview(page: Page, account: { existing?: string; newName?: string }) {
  await page.goto(`${BASE}/settings/import`);
  if (account.newName) {
    await page.getByLabel("Which account is this statement for?").selectOption({ label: "A new account" });
    await page.getByLabel("Name of the new account").fill(account.newName);
  } else {
    await page.getByLabel("Which account is this statement for?").selectOption({ label: account.existing! });
  }
  await page.getByLabel("Bank statement (CSV file)").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText("We recognised this layout: Nationwide-style CSV.").waitFor();
}

async function importRunThrough(page: Page, vpName: string) {
  console.log("\nimport run-through (" + vpName + ")");
  await uploadAndPreview(page, { newName: "Joint account" });
  check(true, "the sample file's layout is recognised");
  await shot(page, `import-step2-${vpName}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText(/rows in the file/).waitFor();
  const summary = (await page.getByText(/rows in the file/).textContent()) ?? "";
  check(/\d+ new/.test(summary) && !/already imported/.test(summary), `preview counts every row as new (${summary.trim()})`);
  check(await page.getByText("Possible duplicate").count() === 0, "no possible duplicates in a fresh account");
  await shot(page, `import-step3-${vpName}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, `preview: the table scrolls in its own box, not the page (overflow ${overflow}px)`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /^Import \d+ transactions$/ }).click();
  await page.waitForURL(/\/settings\/imports\/[^/?]+\?done=1/);
  const firstBatchUrl = page.url().split("?")[0]!;
  check(await page.getByText(/^Imported \d+ transactions\.$/).isVisible(), "the result page confirms the import");
  check(await page.getByText(/Matches the bank on/).isVisible(), "the balance check matches the bank");
  await shot(page, `import-result-${vpName}`);

  await page.getByRole("link", { name: "See these transactions" }).click();
  await page.waitForURL(/\/activity\?batch=/);
  check(await page.getByText("קרן ידידים").first().isVisible(), "Activity lists the imported rows, Hebrew included");
  await shot(page, `activity-imported-${vpName}`);

  // The same file again into the same account adds nothing.
  await uploadAndPreview(page, { existing: "Joint account (Current account)" });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText(/rows in the file/).waitFor();
  const again = (await page.getByText(/rows in the file/).textContent()) ?? "";
  check(/0 new/.test(again) && /already imported/.test(again), `re-import preview: nothing new (${again.trim()})`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Record this import" }).click();
  await page.waitForURL(/\/settings\/imports\/[^/?]+\?done=1/);
  check(await page.getByText("Nothing new: everything in this file was already here.").isVisible(), "re-import adds nothing");

  // Undo the first import, confirmed in place.
  await page.goto(firstBatchUrl);
  await page.getByRole("button", { name: "Undo this import" }).click();
  check(await page.getByText(/^Undo this import\? \d+ transactions will be removed\.$/).isVisible(), "undo asks first, saying how many rows go");
  await shot(page, `import-undo-confirm-${vpName}`);
  await page.getByRole("button", { name: /^Yes, remove/ }).click();
  await page.waitForURL(/undone=1/);
  check(await page.getByText("The import has been undone.").isVisible(), "undo completes");
  await page.goto(`${BASE}/activity?batch=${firstBatchUrl.split("/").at(-1)}`);
  check(await page.getByText("No transactions yet").isVisible() || (await page.getByText("קרן ידידים").count()) === 0, "the undone rows are gone from Activity");
}

async function desktopImportScreens(page: Page) {
  await uploadAndPreview(page, { existing: "Current account (Current account)" });
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByText(/rows in the file/).waitFor();
  await shot(page, "import-step3-desktop");
}

if (!existsSync(".next/BUILD_ID") || process.argv.includes("--build")) {
  console.log("Building the app…");
  const build = spawnSync("bun", ["run", "build"], { stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

// A fresh database just for this check.
const dbDir = mkdtempSync(path.join(tmpdir(), "ffcc-screens-"));
const databaseUrl = `file:${path.join(dbDir, "screens.db")}`;
{
  const db = await createDb(databaseUrl);
  await runMigrations(db);
  const seeded = await seedDatabase(db, { endDate: ukDate() });
  await runEngine(db, seeded.householdId, { today: ukDate(), provider: new MockAiProvider() });
  db.$client.close();
}

const secret = randomBytes(32).toString("hex");
const server = spawn("bunx", ["next", "start", "-p", String(PORT)], {
  env: { ...process.env, FFCC_DEV_LOGIN: "1", SESSION_SECRET: secret, DATABASE_URL: databaseUrl },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (d) => process.stderr.write(d));

const failures: string[] = [];
let checks = 0;
let passed = 0;
const check = (ok: boolean, message: string) => {
  checks++;
  if (ok) passed++;
  else failures.push(message);
  console.log(`${ok ? "  ok  " : "  FAIL"} ${message}`);
};

try {
  await waitForServer(`${BASE}/login`);
  mkdirSync("screenshots", { recursive: true });
  const browser = await chromium.launch({ executablePath: chromiumPath() });

  for (const vp of VIEWPORTS) {
    console.log(`\n${vp.name} (${vp.width}px)`);
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, locale: "en-GB" });
    const page = await context.newPage();

    // Signed out: every area sends you to the login page.
    await page.goto(`${BASE}/activity`);
    check(new URL(page.url()).pathname === "/login", `signed-out visit redirects to /login`);
    if (vp.screenshot) await page.screenshot({ path: `screenshots/login-${vp.name}.png`, fullPage: true });

    // A path that only starts with "login" still needs a session.
    await page.goto(`${BASE}/login-history`);
    check(new URL(page.url()).pathname === "/login", `signed-out visit to /login-history redirects to /login`);

    // A correctly signed cookie for a household that no longer exists (e.g. after `bun run setup`).
    const stale = await signSession({ userId: "01GONEUSER000000000000000", householdId: "01GONEHOUSEHOLD0000000000" }, secret);
    await context.addCookies([{ name: SESSION_COOKIE, value: stale, url: BASE }]);
    await page.goto(`${BASE}/`);
    const staleUrl = new URL(page.url());
    check(
      staleUrl.pathname === "/login" && staleUrl.searchParams.get("expired") === "1",
      `a cookie for a household that no longer exists goes to /login`,
    );
    check(await page.getByText("Your sign-in has expired").isVisible(), `the expired sign-in message shows`);

    await page.getByRole("button", { name: "Continue as the demo household" }).click();
    await page.waitForURL(`${BASE}/`);

    for (const area of AREAS) {
      const res = await page.goto(`${BASE}${area.path}`);
      const label = `${area.heading}`;
      check(res?.status() === 200, `${label}: loads (status ${res?.status()})`);
      check(await page.getByRole("heading", { level: 1, name: area.heading }).isVisible(), `${label}: heading shows`);
      const nav = page.getByRole("navigation", { name: "Main" }).filter({ visible: true });
      check((await nav.count()) === 1, `${label}: one main navigation visible`);
      const current = nav.locator('[aria-current="page"]');
      check((await current.textContent())?.trim() === area.nav, `${label}: navigation marks ${area.nav} as current`);
      check(await page.getByRole("button", { name: "Add" }).filter({ visible: true }).isVisible(), `${label}: Add button visible`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(overflow <= 0, `${label}: no sideways scrolling (overflow ${overflow}px)`);
      if (vp.screenshot) {
        const name = area.path === "/" ? "home" : area.path.slice(1).replace(/\//g, "-");
        // Grow the viewport to the page so the fixed navigation sits at the bottom of the image.
        const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, fullHeight) });
        await page.screenshot({ path: `screenshots/${name}-${vp.name}.png` });
        await page.setViewportSize({ width: vp.width, height: vp.height });
      }
    }

    // Activity shows each row's category and status, and marks transfers and refunds.
    await page.goto(`${BASE}/activity?show=500`);
    const visible = (text: string) => page.getByText(text, { exact: true }).filter({ visible: true }).first().isVisible();
    check(await visible("Auto"), "Activity: status chips show (Auto)");
    check(await visible("Card repayment"), "Activity: card repayments are marked");
    check(await visible("Transfer"), "Activity: transfers are marked");
    check(await visible("Refund"), "Activity: refunds are marked");
    check(await visible("Refunded"), "Activity: refunded purchases are marked");
    check(await page.getByText(/^Groceries( ·|$)/).filter({ visible: true }).first().isVisible(), "Activity: categories show");
    if (vp.name === "desktop") {
      check(await page.getByRole("columnheader", { name: "Category" }).isVisible(), "Activity: the table has a Category column");
      check(await page.getByRole("columnheader", { name: "Status" }).isVisible(), "Activity: the table has a Status column");
    }
    if (vp.screenshot) await page.screenshot({ path: `screenshots/activity-sorted-${vp.name}.png` });

    // Navigation works by clicking, not just by URL.
    await page.goto(`${BASE}/`);
    await page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: "Plan" }).click();
    await page.waitForURL(`${BASE}/plan`);
    check(true, "clicking Plan in the navigation opens Plan");

    if (vp.name === "phone") await importRunThrough(page, vp.name);
    if (vp.name === "desktop") await desktopImportScreens(page);
    await context.close();
  }
  await browser.close();
} catch (error) {
  failures.push(String(error));
  console.error(error);
} finally {
  server.kill("SIGTERM");
  rmSync(dbDir, { recursive: true, force: true });
}

console.log(`\n${passed}/${checks} checks passed.`);
if (failures.length > 0) {
  console.log("Failures:\n" + failures.map((f) => `- ${f}`).join("\n"));
  process.exit(1);
}
console.log("Screenshots saved in screenshots/.");
process.exit(0);
