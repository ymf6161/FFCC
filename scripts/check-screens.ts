/**
 * `bun run check:screens`: Phase 1 "done when" check for screens.
 * Builds (if needed) and starts the app, signs in with the dev login, and
 * opens all five areas at phone and desktop widths. For each one it checks
 * the page loads, the navigation and heading show, and nothing scrolls
 * sideways. Screenshots go to screenshots/.
 *
 * Uses Chromium from PLAYWRIGHT_BROWSERS_PATH or CHROMIUM_PATH if set.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import { SESSION_COOKIE, signSession } from "@/auth/token";

const PORT = Number(process.env.CHECK_PORT ?? 3100);
const BASE = `http://localhost:${PORT}`;
const AREAS = [
  { path: "/", heading: "Home" },
  { path: "/activity", heading: "Activity" },
  { path: "/plan", heading: "Plan" },
  { path: "/reports", heading: "Reports" },
  { path: "/settings", heading: "Settings" },
] as const;
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

if (!existsSync(".next/BUILD_ID") || process.argv.includes("--build")) {
  console.log("Building the app…");
  const build = spawnSync("bun", ["run", "build"], { stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const secret = randomBytes(32).toString("hex");
const server = spawn("bunx", ["next", "start", "-p", String(PORT)], {
  env: { ...process.env, FFCC_DEV_LOGIN: "1", SESSION_SECRET: secret },
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
      check((await current.textContent())?.trim() === area.heading, `${label}: navigation marks this area as current`);
      check(await page.getByRole("button", { name: "Add" }).filter({ visible: true }).isVisible(), `${label}: Add button visible`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      check(overflow <= 0, `${label}: no sideways scrolling (overflow ${overflow}px)`);
      if (vp.screenshot) {
        const name = area.path === "/" ? "home" : area.path.slice(1);
        // Grow the viewport to the page so the fixed navigation sits at the bottom of the image.
        const fullHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ width: vp.width, height: Math.max(vp.height, fullHeight) });
        await page.screenshot({ path: `screenshots/${name}-${vp.name}.png` });
        await page.setViewportSize({ width: vp.width, height: vp.height });
      }
    }

    // Navigation works by clicking, not just by URL.
    await page.goto(`${BASE}/`);
    await page.getByRole("navigation", { name: "Main" }).filter({ visible: true }).getByRole("link", { name: "Plan" }).click();
    await page.waitForURL(`${BASE}/plan`);
    check(true, "clicking Plan in the navigation opens Plan");

    await context.close();
  }
  await browser.close();
} catch (error) {
  failures.push(String(error));
  console.error(error);
} finally {
  server.kill("SIGTERM");
}

console.log(`\n${passed}/${checks} checks passed.`);
if (failures.length > 0) {
  console.log("Failures:\n" + failures.map((f) => `- ${f}`).join("\n"));
  process.exit(1);
}
console.log("Screenshots saved in screenshots/.");
process.exit(0);
