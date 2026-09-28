import { chromium } from "@playwright/test";
import { createServer } from "vite";
import fs from "node:fs/promises";
const server = await createServer({
  server: { host: "127.0.0.1", port: 5173 },
});
await server.listen();
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1180, height: 820 },
  });
  await page.addInitScript(() => {
    window.__TAURI_INTERNALS__ = {
      invoke: async (cmd) => {
        if (cmd === "defaults")
          return { folder: "C:\\Users\\filip\\Downloads\\Smowa" };
        if (cmd === "snapshot")
          return { jobs: [], pending: [], storageError: "" };
        if (cmd === "inspect_video")
          return new Promise(
            (resolve) =>
              (window.finishInspection = () =>
                resolve({
                  title: "Video ready to download",
                  uploader: "Creator",
                  duration: 120,
                  url: "https://www.youtube.com/watch?v=test",
                  formats: [{ height: 1080, vcodec: "avc1" }],
                })),
          );
        if (cmd === "health")
          return { "yt-dlp": true, ffmpeg: true, node: true };
      },
    };
  });
  await page.goto("http://127.0.0.1:5173");
  await page.screenshot({
    path: ".preview/smowaudio-idle.png",
    fullPage: true,
  });
  await page
    .getByRole("textbox", { name: "Video URL", exact: true })
    .fill("https://www.youtube.com/watch?v=test");
  await page.getByRole("button", { name: "Get video" }).click();
  await page.getByRole("button", { name: "Getting video…" }).waitFor();
  for (const width of [1180, 860]) {
    await page.setViewportSize({ width, height: 820 });
    const gap = await page.evaluate(
      () =>
        document.querySelector(".composer").getBoundingClientRect().bottom -
        document.querySelector("#analyze-form").getBoundingClientRect().bottom,
    );
    if (gap < 16) throw Error("Loading bottom padding regressed: " + gap);
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      )
    )
      throw Error("Horizontal overflow");
    console.log(`PASS loading padding at ${width}px: ${gap}px`);
    await page.screenshot({
      path: `.preview/smowaudio-loading-${width}.png`,
      fullPage: true,
    });
  }
  await page.evaluate(() => window.finishInspection());
  await page.locator("#options").waitFor({ state: "visible" });
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.screenshot({
    path: ".preview/smowaudio-options.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    const previous = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = async (cmd) =>
      cmd === "inspect_video"
        ? {
            audioOnly: true,
            title: "Audio source",
            url: "https://soundcloud.com/artist/track",
            formats: [{ vcodec: "none", acodec: "mp3" }],
          }
        : previous(cmd);
  });
  await page.getByRole("button", { name: "Get video" }).click();
  await page.waitForFunction(
    () => document.querySelector("#format").value === "m4a",
  );
  if (
    !(await page.locator("#resolution").isDisabled()) ||
    !(await page.locator("#codec").isDisabled())
  )
    throw Error("Audio source exposed video controls");
  if (
    !(await page
      .locator('#format option[value="mp4"]')
      .evaluate((option) => option.disabled))
  )
    throw Error("Audio source allowed MP4 output");
  console.log("PASS: audio-only source automatically selects audio output");
  await page
    .getByRole("button", { name: "Browser helper", exact: true })
    .click();
  await page.screenshot({
    path: ".preview/smowaudio-helper.png",
    fullPage: true,
  });
  console.log("PASS: loading and loaded layouts, helper navigation");
} finally {
  await browser.close();
  await server.close();
}
