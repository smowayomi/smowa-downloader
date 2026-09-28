import vm from "node:vm";
import fs from "node:fs/promises";
const source = await fs.readFile("extension/popup.js", "utf8");
for (const [url, allowed] of [
  ["https://vimeo.com/123", true],
  ["https://soundcloud.com/artist/track", true],
  ["https://www.twitch.tv/videos/123", true],
  ["https://archive.org/details/test", true],
  ["http://example.org:8080/a.mp4", true],
  ["brave://settings", false],
  ["file:///test.mp4", false],
  ["https://user:pass@example.org", false],
]) {
  const nodes = {};
  let forwarded = false;
  const c = vm.createContext({
    URL,
    Error,
    document: {
      getElementById: (id) =>
        (nodes[id] ??= { textContent: "", addEventListener() {} }),
    },
    chrome: {
      runtime: {
        id: "test",
        sendNativeMessage: async () => {
          forwarded = true;
          return { ok: true };
        },
      },
      tabs: { query: async () => [{ url }] },
    },
  });
  vm.runInContext(source, c);
  await new Promise((r) => setTimeout(r, 0));
  if (forwarded !== allowed) throw Error("Incorrect handling: " + url);
}
console.log(
  "PASS: extension accepts other websites and rejects non-web URLs and embedded credentials",
);
