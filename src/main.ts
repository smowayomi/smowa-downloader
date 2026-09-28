import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  createIcons,
  Download,
  History,
  Settings2,
  ArrowDownToLine,
  Link,
  FolderOpen,
  Plus,
  Check,
  X,
  RotateCcw,
  Search,
  ExternalLink,
  Monitor,
  Chrome,
  ChevronRight,
  Film,
  CircleHelp,
} from "lucide";
import "./style.css";
const downloadIcon = new URL("./download-icon.svg", import.meta.url).href;

type Options = {
  url: string;
  resolution: number;
  codec: string;
  format: string;
  quality: string;
  folder: string;
  start_time?: number;
  end_time?: number;
};
type Job = {
  id: string;
  title: string;
  url: string;
  status: string;
  percent: number;
  speed: string;
  eta: string;
  error: string;
  file: string;
  created: number;
  options: Options;
};
type Video = {
  audioOnly?: boolean;
  title: string;
  thumbnail: string;
  duration: number;
  uploader: string;
  url: string;
  formats: {
    height?: number;
    vcodec?: string;
    acodec?: string;
    ext?: string;
  }[];
};
const desktop = "__TAURI_INTERNALS__" in window;
let jobs: Job[] = [],
  page = "downloads",
  video: Video | null = null,
  analyzing = false,
  busy = false,
  folder = localStorage.getItem("folder") || "",
  filter = "",
  pending: string[] = [],
  toolHealth: Record<string, boolean> = {};
const icons = () =>
  createIcons({
    icons: {
      Download,
      History,
      Settings2,
      ArrowDownToLine,
      Link,
      FolderOpen,
      Plus,
      Check,
      X,
      RotateCcw,
      Search,
      ExternalLink,
      Monitor,
      Chrome,
      ChevronRight,
      Film,
      CircleHelp,
    },
    attrs: {
      "aria-hidden": "true",
      width: 18,
      height: 18,
      "stroke-width": 1.7,
    },
  });
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const active = (j: Job) =>
  ["queued", "downloading", "processing"].includes(j.status);
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
function notify(message: string, error = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = error ? "toast error" : "toast";
  el.hidden = false;
  setTimeout(() => {
    el.hidden = true;
  }, 7000);
}
async function call<T>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  if (!desktop)
    throw Error(
      "This is a browser preview. Open SmowaDL.exe to use desktop features.",
    );
  return invoke<T>(name, args);
}

document.querySelector("#app")!.innerHTML = `
<main><header><div class="brand"><img class="brand-icon" src="${downloadIcon}" alt="" />SmowaDL <span class="brand-detail">Downloader</span></div><span id="crumb" class="sr-only">Downloads</span><div class="header-status"><span class="pill"><span class="status-dot"></span><b>Running</b></span><button id="settings-toggle" class="icon-button" aria-label="Settings" title="Settings" aria-expanded="false" aria-controls="settings-page">${icon("settings-2")}</button></div></header><div class="content"><p id="engine-banner" class="hint" role="status" hidden></p><section id="downloads-page"><div class="page-heading"><div><h1>Downloads</h1><p>Download video and audio from hundreds of sites supported by yt-dlp.</p></div><button class="secondary" id="focus-url">${icon("plus")} New download</button></div>
<section class="composer"><div class="composer-top"><span class="section-label">${icon("link")} ADD A MEDIA LINK</span><div class="platforms"><span>YouTube</span><span>Vimeo</span><span>SoundCloud</span><span>+ hundreds more</span></div></div><form id="analyze-form"><label class="sr-only" for="url">Video URL</label><div class="url-row"><input id="url" type="url" required placeholder="Paste a video link here…" autocomplete="off"><button class="primary" id="analyze" type="submit">Get video ${icon("chevron-right")}</button></div></form><div id="analyze-error" class="inline-error" role="alert" hidden></div><div id="video-info" hidden></div><div id="options" hidden><div class="option-grid"><label>Resolution<select id="resolution"></select></label><label>Video codec<select id="codec"></select></label><label>Format<select id="format"><option value="mp4">MP4 · Video</option><option value="mkv">MKV · Video</option><option value="webm">WebM · Video</option><option value="mp3">MP3 · Audio</option><option value="m4a">M4A · Audio</option></select></label><label>Quality<select id="quality"><option value="best">Best available</option><option value="balanced">Balanced · prefer 30 fps</option><option value="small">Smaller · prefer lower bitrate</option></select></label></div><p class="hint" id="quality-hint">Original streams, no video re-encoding. Resolution is a maximum; availability depends on the video.</p><div class="clip-controls"><label class="update-toggle"><input id="clip-enabled" type="checkbox"> Download a section</label><div id="clip-fields" class="clip-fields" hidden><label>Start<input id="clip-start" placeholder="0:00" value="0:00" inputmode="decimal" aria-describedby="clip-hint"></label><label>End<input id="clip-end" placeholder="1:30" inputmode="decimal" aria-describedby="clip-hint"></label><p id="clip-hint" class="hint">Use seconds, mm:ss or hh:mm:ss. Exact cuts may re-encode video and take longer. Some sites still transfer the full source.</p></div></div><div class="destination"><button id="choose-folder" class="folder-button">${icon("folder-open")}<span><small>SAVE TO</small><span id="folder-label"></span></span></button><button id="download" class="primary">${icon("arrow-down-to-line")} Download</button></div></div><div id="composer-hint" class="composer-hint">${icon("chrome")} Send the current video from your browser with the browser helper.</div></section>
<div class="list-heading"><h2>All downloads <span id="active-count">0</span></h2><button id="clear-history" class="secondary">Clear finished</button></div><label class="search-box">${icon("search")}<input id="search" placeholder="Search title or website" aria-label="Search downloads"></label><div id="history-list"></div><div class="tip"><span>${icon("circle-help")}</span><p>Downloads continue when you close this window.</p></div></section>
<section id="settings-page" hidden><section class="setup-card"><h2>App updates <span id="app-version"></span></h2><label class="update-toggle"><input type="checkbox" id="auto-updates"> Automatically download and install updates</label><p class="hint">Installs when downloads are finished and this window is closed. Your history and preferences are kept.</p><p id="update-status" role="status">Checking update settings...</p><div class="update-actions"><button id="check-update" class="secondary">Check for updates</button><button id="install-update" class="primary" hidden>Update now</button></div></section><div class="page-heading"><div><h1>Browser helper</h1><p>One click in your browser brings the current video to SmowaDL.</p></div></div><section class="setup-card"><div class="setup-icon">${icon("chrome")}</div><h2>Connect Brave or Chrome</h2><p>Load the included extension in Brave or Chrome once. Windows app links connect it automatically.</p><ol><li>Open <code>brave://extensions</code> (or <code>chrome://extensions</code>) and enable <strong>Developer mode</strong>.</li><li>Click <strong>Load unpacked</strong> and select the <code>extension</code> folder beside SmowaDL.exe.</li><li>Copy the extension’s ID and paste it below.</li></ol><p class="hint">The controls below are only for older extensions using the native helper.</p><label for="extension-id">Legacy browser extension ID</label><div class="url-row"><input id="extension-id" placeholder="32-letter extension ID" maxlength="32"><button id="connect" class="primary">Connect helper</button></div><p id="connect-result" role="status"></p><div class="hint">Pin SmowaDL to your browser toolbar. Click it on a video to open the download options, even when the app is closed.</div></section><section class="setup-card"><h2>Download engine</h2><p>yt-dlp downloads media. FFmpeg merges, trims and converts it. Node.js runs JavaScript that yt-dlp needs for sites such as YouTube; it is a helper, not a separate downloader. Tools check for the latest stable releases at startup and daily when downloads are idle.</p><div id="health" class="health"></div><p class="hint">If a site changes, close SmowaDL and run Update tools.cmd in the release folder. Some private or restricted videos require authentication and are not supported by this version.</p><button id="check-tools" class="secondary">Check tools</button> <button id="setup-tools" class="secondary">Set up / update tools</button></section></section></div><footer><span><span class="status-dot"></span> <span id="footer-status">Ready when you are</span></span><span>Files stay on your computer</span></footer></main><div id="toast" class="toast" role="status" hidden></div>`;

function navigate(next: string) {
  page = next;
  $("settings-page").hidden = page !== "settings";
  $("settings-toggle").setAttribute("aria-expanded", String(page === "settings"));
  document.querySelectorAll("[data-page]").forEach((b) => {
    const selected = (b as HTMLElement).dataset.page === page;
    b.classList.toggle("active", selected);
    if (selected) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  $("crumb").textContent =
    page === "settings"
      ? "Browser helper"
      : page === "history"
        ? "History"
        : "Downloads";
  renderJobs();
  if (page === "settings") void checkTools();
}
$("settings-page").parentElement!.prepend($("settings-page"));
$("settings-toggle").onclick = () => {
  navigate(page === "settings" ? "downloads" : "settings");
  window.scrollTo({ top: 0 });
};
$("focus-url").onclick = () => {
  $<HTMLInputElement>("url").focus();
};
$("search").oninput = () => {
  filter = $<HTMLInputElement>("search").value.toLowerCase();
  renderJobs();
};
$("clear-history").onclick = async () => {
  if (
    !confirm(
      "Clear finished and stopped entries from history? Your downloaded files will be kept.",
    )
  )
    return;
  try {
    await call("clear_history");
    await refresh();
  } catch (e) {
    notify(String(e), true);
  }
};
function renderJobs() {
  const queue = jobs.filter(active),
    history = jobs.filter(
      (j) => `${j.title} ${j.url}`.toLowerCase().includes(filter),
    );
  $("active-count").textContent = String(jobs.length);
  $("footer-status").textContent = queue.length
    ? `${queue.length} download${queue.length === 1 ? "" : "s"} in queue`
    : "Ready when you are";
  $("history-list").innerHTML = history.length
    ? history.map(card).join("")
    : `<div class="empty-state"><div class="empty-icon">${icon("history")}</div><h3>${filter ? "No matching downloads" : "Your collection starts here"}</h3><p>${filter ? "Try another title or website." : "Queued, active and finished downloads appear here."}</p></div>`;
  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          await call(b.dataset.action!, { id: b.dataset.id });
          await refresh();
        } catch (e) {
          notify(String(e), true);
        } finally {
          b.disabled = false;
        }
      }),
  );
  icons();
}
function card(j: Job) {
  let host = "";
  try {
    host = new URL(j.url).hostname.replace("www.", "");
  } catch {}
  const running = active(j),
    done = j.status === "completed";
  return `<article class="job"><div class="job-icon ${done ? "complete" : ""}">${icon(done ? "check" : "film")}</div><div class="job-body"><div class="job-top"><h3 title="${esc(j.title)}">${esc(j.title || j.url)}</h3><span class="job-status ${esc(j.status)}">${esc(j.status)}</span></div><div class="job-meta">${esc(host)}<span>·</span>${esc(j.options.format.toUpperCase())}<span>·</span>${j.options.resolution ? j.options.resolution + "p" : "Best"}<span>·</span>${new Date(j.created * 1000).toLocaleDateString()}${j.options.start_time != null ? `<span>·</span>Clip ${j.options.start_time}s–${j.options.end_time}s` : ""}</div>${running ? `<progress max="100" value="${j.percent}" aria-label="Download progress"></progress><div class="progress-label"><span>${j.status === "queued" ? "Waiting in queue" : j.status === "processing" ? "Merging / converting" : esc(j.speed) || "Connecting…"}</span><span>${j.eta ? "ETA " + esc(j.eta) + " · " : ""}${j.percent.toFixed(1)}%</span></div>` : ""}${j.error ? `<details><summary>Download details</summary><pre>${esc(j.error)}</pre></details>` : ""}</div><button class="icon-button" data-action="${running ? "cancel" : done ? "reveal" : "retry"}" data-id="${j.id}" aria-label="${running ? "Cancel download" : done ? "Show in folder" : "Retry download"}" title="${running ? "Cancel download" : done ? "Show in folder" : "Retry download"}">${icon(running ? "x" : done ? "folder-open" : "rotate-ccw")}</button></article>`;
}

$("analyze-form").onsubmit = async (e) => {
  e.preventDefault();
  await analyze($<HTMLInputElement>("url").value);
};
async function analyze(url: string) {
  if (analyzing) return;
  analyzing = true;
  video = null;
  $("options").hidden = true;
  $("video-info").hidden = true;
  $("composer-hint").hidden = true;
  $("analyze-error").hidden = true;
  $<HTMLButtonElement>("analyze").disabled = true;
  $("analyze").textContent = "Getting video…";
  try {
    video = await call<Video>("inspect_video", { url });
    $<HTMLInputElement>("clip-enabled").checked = false;
    $("clip-fields").hidden = true;
    $<HTMLInputElement>("clip-start").value = "0:00";
    $<HTMLInputElement>("clip-end").value = video.duration ? String(video.duration) : "";
    $("video-info").hidden = false;
    let thumb = "";
    try {
      const u = new URL(video.thumbnail);
      if (u.protocol === "https:") thumb = u.href;
    } catch {}
    $("video-info").innerHTML =
      `${thumb ? `<img src="${esc(thumb)}" alt="" referrerpolicy="no-referrer">` : `<div class="video-placeholder">${icon("film")}</div>`}<div><span class="section-label">READY TO DOWNLOAD</span><h3>${esc(video.title)}</h3><p>${esc(video.uploader || "Video")} ${video.duration ? "· " + Math.floor(video.duration / 60) + ":" + String(Math.floor(video.duration % 60)).padStart(2, "0") : ""}</p></div>`;
    const heights = [
      ...new Set(
        (video.formats || [])
          .map((f) => f.height)
          .filter((h): h is number => !!h),
      ),
    ];
    $<HTMLSelectElement>("resolution").innerHTML =
      '<option value="0">Best available</option>' +
      [4320, 2160, 1440, 1080, 720, 480, 360]
        .filter(
          (h) =>
            h <= Math.max(...heights, 0) ||
            (h === 360 && heights.some((x) => x < 360)),
        )
        .map((h) => `<option value="${h}">${h}p maximum</option>`)
        .join("");
    const codecs = (video.formats || []).map((f) => f.vcodec || "");
    $<HTMLSelectElement>("codec").innerHTML =
      '<option value="auto">Auto · recommended</option>' +
      [
        ["h264", "H.264 · compatible", "avc"],
        ["vp9", "VP9", "vp9"],
        ["av1", "AV1 · efficient", "av01"],
      ]
        .filter((c) => codecs.some((v) => v.startsWith(c[2])))
        .map((c) => `<option value="${c[0]}">${c[1]}</option>`)
        .join("");
    const format = $<HTMLSelectElement>("format");
    for (const option of Array.from(format.options))
      option.disabled =
        !!video.audioOnly && !["mp3", "m4a"].includes(option.value);
    if (video.audioOnly && !["mp3", "m4a"].includes(format.value))
      format.value = "m4a";
    $("options").hidden = false;
    updateFormat();
    updateFolder();
    icons();
  } catch (e) {
    $("analyze-error").textContent = String(e);
    $("analyze-error").hidden = false;
    $("composer-hint").hidden = false;
  } finally {
    analyzing = false;
    $<HTMLButtonElement>("analyze").disabled = false;
    $("analyze").innerHTML = `Get video ${icon("chevron-right")}`;
    icons();
  }
}
function updateFolder() {
  $("folder-label").textContent = folder || "Choose a download folder";
}
$("choose-folder").onclick = async () => {
  try {
    if (!desktop)
      throw Error("Folder selection is available in the desktop app.");
    const result = await open({
      directory: true,
      multiple: false,
      defaultPath: folder || undefined,
    });
    if (typeof result === "string") {
      folder = result;
      localStorage.setItem("folder", folder);
      updateFolder();
    }
  } catch (e) {
    notify(String(e), true);
  }
};
function updateFormat() {
  const audio = ["mp3", "m4a"].includes($<HTMLSelectElement>("format").value);
  $<HTMLSelectElement>("resolution").disabled = audio;
  $<HTMLSelectElement>("codec").disabled = audio;
  $("quality-hint").textContent = audio
    ? "Audio is extracted and converted with FFmpeg. Quality controls the audio encoding."
    : "Original streams, no video re-encoding. Resolution is a maximum; availability depends on the video.";
}
$("format").onchange = updateFormat;
function parseTimestamp(value: string): number {
  const text = value.trim();
  if (!/^\d+(?::[0-5]?\d){0,2}(?:\.\d{1,3})?$/.test(text)) throw Error("Use seconds, mm:ss or hh:mm:ss for timestamps.");
  const seconds = text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  if (!Number.isFinite(seconds)) throw Error("Invalid timestamp.");
  return seconds;
}
$("clip-enabled").onchange = () => { $("clip-fields").hidden = !$<HTMLInputElement>("clip-enabled").checked; };
$("download").onclick = async () => {
  if (!video || busy) return;
  busy = true;
  $<HTMLButtonElement>("download").disabled = true;
  try {
    let start_time: number | undefined, end_time: number | undefined;
    if ($<HTMLInputElement>("clip-enabled").checked) {
      start_time = parseTimestamp($<HTMLInputElement>("clip-start").value);
      end_time = parseTimestamp($<HTMLInputElement>("clip-end").value);
      if (end_time <= start_time) throw Error("End time must be after start time.");
      if (video.duration && end_time > video.duration) throw Error("End time exceeds the video duration.");
    }
    const options: Options = {
      start_time, end_time,
      url: video.url,
      resolution: Number($<HTMLSelectElement>("resolution").value),
      codec: $<HTMLSelectElement>("codec").value,
      format: $<HTMLSelectElement>("format").value,
      quality: $<HTMLSelectElement>("quality").value,
      folder,
    };
    await call("start_download", { options, title: video.title });
    filter = "";
    $<HTMLInputElement>("search").value = "";
    renderJobs();
    notify("Added to downloads");
    await refresh();
    $("history-list").scrollIntoView({ block: "nearest" });
  } catch (e) {
    notify(String(e), true);
  } finally {
    busy = false;
    $<HTMLButtonElement>("download").disabled = false;
  }
};
$("connect").onclick = async () => {
  try {
    await call("register_extension", {
      extensionId: $<HTMLInputElement>("extension-id").value.trim(),
    });
    $("connect-result").textContent =
      "Connected. Click the SmowaDL extension on a video to try it.";
    localStorage.setItem(
      "extensionId",
      $<HTMLInputElement>("extension-id").value.trim(),
    );
  } catch (e) {
    $("connect-result").textContent = String(e);
  }
};
$<HTMLInputElement>("extension-id").value =
  localStorage.getItem("extensionId") || "";
async function checkTools() {
  try {
    toolHealth = await call("health");
    $("health").innerHTML = Object.entries(toolHealth)
      .map(
        ([k, v]) =>
          `<span class="health-item ${v ? "ok" : "missing"}">${icon(v ? "check" : "x")}${esc(k === "node" ? "JavaScript support (Node.js)" : k)} · ${v ? "Ready" : "Missing"}</span>`,
      )
      .join("");
    icons();
  } catch (e) {
    $("health").textContent = String(e);
  }
}
$("check-tools").onclick = checkTools;
type UpdateStatus = { enabled: boolean; message: string; version: string; ready: boolean; busy: boolean };
async function refreshUpdates() {
  if (!desktop) return;
  try {
    const [status, engine] = await Promise.all([call<UpdateStatus>("update_status"), call<string>("engine_status")]);
    if (status) {
      $<HTMLInputElement>("auto-updates").checked = status.enabled;
      $("app-version").textContent = `v${status.version}`;
      $("update-status").textContent = status.message;
      $("install-update").hidden = !status.ready;
      $<HTMLButtonElement>("check-update").disabled = status.busy;
      $<HTMLButtonElement>("install-update").disabled = status.busy || jobs.some(active);
    }
    $("engine-banner").textContent = engine || "";
    $("engine-banner").hidden = !engine;
  } catch { $("update-status").textContent = "Could not read update status."; }
}
$("auto-updates").onchange = async () => {
  try { await call("set_auto_updates", {enabled: $<HTMLInputElement>("auto-updates").checked}); }
  catch (e) { notify(String(e), true); }
  await refreshUpdates();
};
for (const [id, command] of [["check-update", "check_update"], ["install-update", "install_update"], ["setup-tools", "prepare_engine"]]) {
  $(id).onclick = async () => {
    $<HTMLButtonElement>(id).disabled = true;
    try { await call(command); } catch(e) { notify(String(e), true); }
    finally { $<HTMLButtonElement>(id).disabled = false; await refreshUpdates(); }
  };
}
let refreshing = false;
let refreshAgain = false;
async function refresh() {
  if (!desktop) return;
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    const data = await call<{
      jobs: Job[];
      pending: string[];
      storageError: string;
    }>("snapshot");
    const changed = JSON.stringify(jobs) !== JSON.stringify(data.jobs);
    jobs = data.jobs;
    if (changed) renderJobs();
    pending.push(...data.pending);
    if (data.storageError) notify(data.storageError, true);
    if (pending.length && !analyzing) {
      const url = pending.shift()!;
      navigate("downloads");
      $<HTMLInputElement>("url").value = url;
      void analyze(url);
    }
  } catch (e) {
    console.error(e);
  } finally {
    refreshing = false;
    if (refreshAgain) { refreshAgain = false; void refresh(); }
  }
}
async function init() {
  icons();
  renderJobs();
  if (desktop) {
    try {
      const d = await call<{ folder: string }>("defaults");
      if (!folder) folder = d.folder;
      updateFolder();
      await refresh();
      setInterval(() => void refresh(), 700);
      await refreshUpdates();
      setInterval(() => void refreshUpdates(), 3000);
    } catch (e) {
      notify(String(e), true);
    }
  } else {
    $("footer-status").textContent =
      "Design preview · open the desktop app to download";
  }
}
void init();
