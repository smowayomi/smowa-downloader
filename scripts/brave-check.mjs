import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
const ext = path.resolve("release/Smowa/extension");
const manifest = JSON.parse(
  await fs.readFile(
    path.join(process.env.APPDATA, "com.smowa.downloader/native-host.json"),
    "utf8",
  ),
);
const id = new URL(manifest.allowed_origins[0]).hostname;
const count = () =>
  execFileSync(
    "tasklist.exe",
    ["/FI", "IMAGENAME eq smowa.exe", "/FO", "CSV", "/NH"],
    { encoding: "utf8", windowsHide: true },
  )
    .split("\n")
    .filter((l) => /^"smowa.exe"/i.test(l)).length;
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
  const before = count();
  // Exercise the actual popup button with a video-tab fixture; native messaging is real.
  await p.evaluate(() => {
    chrome.tabs.query = async () => [
      { url: "https://www.youtube.com/watch?v=jNQXAC9IVRw" },
    ];
  });
  for (let i = 0; i < 2; i++) {
    await p.getByRole("button", { name: "Open in Smowa" }).click();
    await p
      .getByText("Opened in Smowa. Choose your download options there.")
      .waitFor();
    await new Promise((r) => setTimeout(r, 1500));
    if (count() !== 1) throw Error("Expected exactly one app instance");
    console.log(
      `PASS ${i === 0 && before === 0 ? "app closed → launch" : "app running → reuse"} through Brave native messaging and popup handler`,
    );
  }
  await p.screenshot({ path: ".preview/brave-connected.png" });
} finally {
  await ctx.close();
}
