const status = document.getElementById("status");
async function send() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const u = new URL(tab.url);
    if (
      u.protocol !== "https:" ||
      !["youtube.com", "youtu.be", "tiktok.com", "instagram.com"].some(
        (h) => u.hostname === h || u.hostname.endsWith("." + h),
      )
    )
      throw new Error("Open a YouTube, TikTok or Instagram video first.");
    const reply = await chrome.runtime.sendNativeMessage(
      "com.smowa.downloader",
      { url: u.href },
    );
    if (!reply.ok) throw new Error(reply.error || "Could not open Smowa.");
    status.textContent = "Opened in Smowa. Choose your download options there.";
  } catch (e) {
    status.textContent = e.message.includes("host")
      ? "Connect the extension first: copy its ID from chrome://extensions into Smowa’s Browser helper settings."
      : e.message;
  }
}
document.getElementById("send").addEventListener("click", send);
send();
