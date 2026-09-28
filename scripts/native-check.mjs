// Run against a test instance launched with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9227.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9227");
const page = browser.contexts()[0].pages()[0];
await page.waitForFunction(() => !!window.__TAURI_INTERNALS__);
const call = (name, args = {}) =>
  page.evaluate(
    ({ name, args }) => window.__TAURI_INTERNALS__.invoke(name, args),
    { name, args },
  );
const health = await call("health");
if (!Object.values(health).every(Boolean))
  throw Error("Missing tools: " + JSON.stringify(health));
await page.evaluate(
  (folder) => localStorage.setItem("folder", folder),
  path.resolve(".preview/downloads"),
);
await page.reload();
await page.getByRole("heading", { name: "Downloads", exact: true }).waitFor();
async function bridge(url) {
  const message = Buffer.from(JSON.stringify({ url }));
  const size = Buffer.alloc(4);
  size.writeUInt32LE(message.length);
  const proc = spawn(path.resolve("release/Smowa/smowa-bridge.exe"), [], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const buffers = [];
  proc.stdout.on("data", (b) => buffers.push(b));
  proc.stdin.end(Buffer.concat([size, message]));
  await new Promise((resolve, reject) => {
    proc.on("error", reject);
    proc.on("exit", resolve);
  });
  const result = Buffer.concat(buffers);
  if (result.length < 4) throw Error("No native reply");
  return JSON.parse(result.subarray(4, 4 + result.readUInt32LE(0)).toString());
}
if ((await bridge("file:///unsupported")).ok)
  throw Error("Bridge allowed unsupported URL");
if (
  !(
    await bridge(
      process.env.SMOWA_TEST_URL ||
        "https://www.youtube.com/watch?v=jNQXAC9IVRw",
    )
  ).ok
)
  throw Error("Bridge did not open app");
await page.locator("#options").waitFor({ state: "visible", timeout: 60000 });
const title = await page.locator("#video-info h3").textContent();
await page.locator("#resolution").selectOption("0");
await page.screenshot({ path: ".preview/native-options.png", fullPage: true });
const previousIds = new Set((await call("snapshot")).jobs.map((j) => j.id));
await page.getByRole("button", { name: "Download", exact: true }).click();
let completed;
for (let attempt = 0; attempt < 90; attempt++) {
  const { jobs } = await call("snapshot");
  const job = jobs.find((j) => j.title === title && !previousIds.has(j.id));
  if (job?.status === "failed") throw Error(job.error);
  if (job?.status === "completed") {
    completed = job;
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
if (!completed) throw Error("Download did not complete");
const stat = await fs.stat(completed.file);
if (stat.size < 1000) throw Error("Output file is unexpectedly small");
await page.getByRole("button", { name: "History", exact: true }).click();
await page.getByRole("heading", { name: title, exact: true }).first().waitFor();
await page.screenshot({ path: ".preview/native-history.png", fullPage: true });
await fs.writeFile(
  ".preview/native-result.json",
  JSON.stringify(
    { health, title, file: completed.file, bytes: stat.size, id: completed.id },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      result: "PASS",
      health,
      title,
      bytes: stat.size,
      checks: [
        "native message validation",
        "single-instance handoff",
        "live video metadata",
        "download through UI",
        "real output file",
        "history UI",
      ],
    },
    null,
    2,
  ),
);
await browser.close();
