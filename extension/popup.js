const status = document.getElementById("status");
const button = document.getElementById("send");
const details = document.getElementById("details");
document.getElementById("extension-id").textContent = chrome.runtime.id;
let sending = false;
async function send() {
  if (sending) return;
  sending = true;
  button.disabled = true;
  status.textContent = "Opening Smowa…";
  details.textContent = "";
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const u = new URL(tab?.url || "");
    if (
      !["http:", "https:"].includes(u.protocol) ||
      !u.hostname ||
      u.username ||
      u.password
    )
      throw Error(
        "Open an HTTP or HTTPS video or audio page first (without embedded login credentials).",
      );
    const reply = await chrome.runtime.sendNativeMessage(
      "com.smowa.downloader",
      { url: u.href },
    );
    if (!reply?.ok)
      throw Error(
        reply?.error || "The desktop helper did not confirm the request.",
      );
    status.textContent = "Opened in Smowa. Choose your download options there.";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/not found|not registered/i.test(message))
      status.textContent =
        "Brave or Chrome cannot find the desktop helper. Open Smowa → Browser helper and connect the ID shown below, then reload this extension.";
    else if (/forbidden|not allowed|access.*denied/i.test(message))
      status.textContent =
        "This extension ID is not allowed by the desktop helper. Reconnect the ID shown below in Smowa → Browser helper.";
    else if (
      /host.*exited|communicating|disconnected|failed to start/i.test(message)
    )
      status.textContent =
        "The desktop helper could not start or lost its connection. Keep smowa.exe and smowa-bridge.exe together in the release folder, then reconnect in Smowa.";
    else status.textContent = message;
    details.textContent = message;
  } finally {
    sending = false;
    button.disabled = false;
  }
}
button.addEventListener("click", send);
send();
