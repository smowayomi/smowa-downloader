import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
const ext = path.resolve("release/Smowa/extension");
const manifest = JSON.parse(
  await fs.readFile(
    path.join(process.env.APPDATA, "com.smowa.downloader/native-host.json"),
    "utf8",
  ),
);
const id = new URL(manifest.allowed_origins[0]).hostname;
const ctx = await chromium.launchPersistentContext(
  path.resolve(".preview/brave-bridge-check"),
  {
    executablePath:
      "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
    headless: true,
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  },
);
try {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${id}/popup.html`);
  // Legacy native messaging remains available independently of the app-link popup.
  for (let i = 0; i < 2; i++) {
    const reply = await p.evaluate(() => chrome.runtime.sendNativeMessage('com.smowa.downloader', {url:'https://www.youtube.com/watch?v=jNQXAC9IVRw'}));
    if (!reply?.ok) throw Error(reply?.error || 'No native confirmation');
    console.log('PASS legacy Brave native messaging');
  }
  await p.screenshot({ path: ".preview/brave-connected.png" });
} finally {
  await ctx.close();
}
