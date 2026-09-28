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
  await page.waitForFunction(() => document.querySelector("#analyze").disabled);
  for (const width of [1180, 880, 760, 640]) {
    await page.setViewportSize({ width, height: 820 });
    const gap = await page.evaluate(
      () =>
        document.querySelector(".composer").getBoundingClientRect().bottom -
        document.querySelector("#analyze-form").getBoundingClientRect().bottom,
    );
    if (gap < 12) throw Error("Loading bottom padding regressed: " + gap);
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
  for (const [width, height] of [[880, 620], [640, 480]]) {
    await page.setViewportSize({width, height});
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Compact layout overflows');
    const download = page.locator('.destination .primary');
    await download.scrollIntoViewIfNeeded();
    if (!(await download.isVisible())) throw Error('Download action inaccessible');
    await page.evaluate(() => scrollTo(0, 0));
    if (width === 880 && (await download.boundingBox()).y + (await download.boundingBox()).height > height) throw Error('Default size requires scrolling to download');
    await page.screenshot({path: `.preview/compact-${width}.png`, fullPage: true});
    console.log(`PASS compact loaded layout ${width}x${height}`);
  }
  await page.evaluate(() => {
    const previous = window.__TAURI_INTERNALS__.invoke;
    window.testJobs = [];
    window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === 'snapshot') return {jobs: structuredClone(window.testJobs), pending: [], storageError: ''};
      if (cmd === 'start_download') {
        window.testJobs.unshift({id:'test-job', title:args.title, url:args.options.url, options:args.options, status:'queued', percent:0, speed:'', eta:'', error:'', file:'', created:Date.now()/1000});
        return 'test-job';
      }
      return previous(cmd, args);
    };
  });
  await page.locator('#clip-enabled').check();
  await page.locator('#clip-start').fill('0:10');
  await page.locator('#clip-end').fill('0:05');
  await page.locator('#download').click();
  if (await page.evaluate(() => window.testJobs.length) !== 0) throw Error('Invalid clip range accepted');
  await page.locator('#clip-end').fill('0:15.500');
  await page.getByRole('textbox', {name:'Search downloads'}).fill('no match');
  await page.locator('#download').click();
  await page.locator('#history-list .job-status').filter({hasText:'queued'}).waitFor();
  if (await page.locator('#search').inputValue()) throw Error('New download hidden by search');
  const clip = await page.evaluate(() => window.testJobs[0].options);
  if (clip.start_time !== 10 || clip.end_time !== 15.5) throw Error('Timestamp conversion failed');
  console.log('PASS timestamp validation and section request');
  await page.evaluate(() => { window.testJobs[0].status = 'completed'; window.testJobs[0].percent = 100; });
  await page.getByRole('button', {name:'Show in folder', exact:true}).waitFor();
  if (await page.locator('#history-list .job').count() !== 1) throw Error('Job lost or duplicated on completion');
  const alignment = await page.locator('#history-list .job').evaluate(row => {
    const badge = row.querySelector('.job-status').getBoundingClientRect();
    const button = row.querySelector('.icon-button').getBoundingClientRect();
    return Math.abs((badge.y + badge.height / 2) - (button.y + button.height / 2));
  });
  if (alignment > 1) throw Error(`Status and action misaligned by ${alignment}px`);
  await page.screenshot({path:'.preview/completed-alignment.png', fullPage:true});
  console.log('PASS queued download appears immediately and remains after completion');
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
    .getByRole("button", { name: "Settings", exact: true })
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
