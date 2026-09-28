import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
await fs.mkdir(".preview", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1180, height: 820 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:5173");
await page.getByRole("heading", { name: "Downloads", exact: true }).waitFor();
await page.screenshot({ path: ".preview/downloads.png", fullPage: true });
await page.getByRole("button", { name: "History", exact: true }).click();
await page.getByRole("heading", { name: "Download history" }).waitFor();
await page
  .getByRole("textbox", { name: "Search download history" })
  .fill("nothing");
await page.getByRole("heading", { name: "No matching downloads" }).waitFor();
await page.getByRole("button", { name: "Browser helper", exact: true }).click();
await page
  .getByRole("heading", { name: "Connect Chrome", exact: true })
  .waitFor();
await page.screenshot({ path: ".preview/helper.png", fullPage: true });
await page.setViewportSize({ width: 860, height: 650 });
if (
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
)
  throw Error("Horizontal overflow at minimum size");
await page.getByRole("button", { name: /Downloads/ }).click();
await page
  .getByRole("textbox", { name: "Video URL", exact: true })
  .fill("https://www.youtube.com/watch?v=BaW_jenozKc");
await page.getByRole("button", { name: "Get video" }).click();
await page.getByRole("alert").filter({ hasText: "browser preview" }).waitFor();
await page.screenshot({ path: ".preview/minimum.png", fullPage: true });
if (errors.length) throw Error(errors.join("\n"));
console.log(
  "PASS: navigation, history search, preview feedback, minimum width, no JavaScript errors.",
);
await browser.close();
