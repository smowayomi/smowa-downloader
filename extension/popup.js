const status = document.getElementById("status");
const button = document.getElementById("send");
const details = document.getElementById("details");
chrome.tabs.query({active: true, currentWindow: true}).then(([tab]) => {
  const u = new URL(tab?.url || "");
  if (!["http:", "https:"].includes(u.protocol) || !u.hostname || u.username || u.password) throw Error("Open a video or audio webpage first.");
  button.href = "smowadl://download?url=" + encodeURIComponent(u.href);
  button.removeAttribute("aria-disabled");
  status.textContent = "Choose quality and download in SmowaDL.";
}).catch(e => { status.textContent = e.message; });
button.addEventListener("click", event => {
  if (!button.hasAttribute("href")) { event.preventDefault(); return; }
  status.textContent = "Allow Brave to open SmowaDL if prompted.";
  details.textContent = "Nothing opened? Run SmowaDL once from its release folder to set up app links, then try again.";
});
