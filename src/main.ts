import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  createIcons,
  Pause,
  Play,
  ArrowUp,
  ArrowDown,
  Copy,
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
import { TrimEditor } from "./trim";
const downloadIcon = new URL("./download-icon.svg", import.meta.url).href;

type Options = {
  url: string;
  resolution: number;
  codec: string;
  format: string;
  quality: string;
  folder: string;
  fragment_concurrency?: number;
  start_time?: number;
  end_time?: number;
};
type Job = {
  id: string;
  title: string;
  url: string;
  status: string;
  percent: number;
  queue_order?: number;
  phase?: string;
  downloaded_bytes?: number;
  total_bytes?: number;
  total_estimated?: boolean;
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
    url?: string;
    protocol?: string;
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
  engineBusy = false,
  folder = localStorage.getItem("folder") || "",
  filter = "",
  statusFilter = "all",
  pending: string[] = [],
  toolHealth: Record<string, boolean> = {};
const icons = () =>
  createIcons({
    icons: {
      Pause, Play, ArrowUp, ArrowDown,
      Copy,
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
<main><header><div class="brand"><img class="brand-icon" src="${downloadIcon}" alt="" />SmowaDL <span class="brand-detail">Downloader</span></div><nav class="top-tabs" aria-label="Main navigation"><button data-page="downloads" aria-controls="downloads-page" aria-current="page" class="active">${icon("download")} Downloader</button><button data-page="history" aria-controls="history-page">${icon("history")} History/Queue <span id="queue-count" hidden></span></button><button data-page="settings" aria-controls="settings-page">${icon("settings-2")} Settings</button></nav><span id="crumb" class="sr-only">Downloader</span></header><div class="content"><p id="engine-banner" class="hint" role="status" hidden></p><div id="incoming-links" class="incoming-links" hidden><span id="incoming-summary"></span><button id="incoming-next" class="secondary">Save draft &amp; open next</button><button id="restore-draft" class="secondary" hidden>Restore previous draft</button></div><section id="downloads-page"><div class="page-heading"><div><h1>New download</h1><p>Paste a link, choose your format, and save.</p></div><button class="secondary" id="focus-url">${icon("x")} Clear form</button></div>
<section class="composer"><div class="composer-top"><span class="section-label">${icon("link")} ADD A MEDIA LINK</span><div class="platforms"><span>YouTube</span><span>Vimeo</span><span>SoundCloud</span><span>+ hundreds more</span></div></div><form id="analyze-form"><label class="sr-only" for="url">Video URL</label><div class="url-row"><input id="url" type="url" required placeholder="Paste a video link here…" autocomplete="off"><button class="primary" id="analyze" type="submit">Get video ${icon("chevron-right")}</button></div></form><div id="analyze-error" class="inline-error" role="alert" hidden></div><div id="video-info" hidden></div><div id="options" hidden><div class="option-grid"><label>Format<select id="format"><option value="mp4">MP4 · Video</option><option value="mkv">MKV · Video</option><option value="webm">WebM · Video</option><option value="mp3">MP3 · Audio</option><option value="m4a">M4A · Audio</option></select></label><label>Resolution<select id="resolution"></select></label><label>Video codec<select id="codec"></select></label><label><span id="quality-label">Quality</span><select id="quality"><option value="best">Best available</option><option value="balanced">Balanced · prefer 30 fps</option><option value="small">Smaller · prefer lower bitrate</option></select></label></div><p class="hint" id="quality-hint">Original streams, no video re-encoding. Resolution is a maximum; availability depends on the video.</p><div class="clip-controls"><label class="update-toggle"><input id="clip-enabled" type="checkbox"> Download a section</label><div id="clip-fields" hidden></div></div><p id="download-error" class="inline-error" role="alert" hidden></p><div class="destination"><button id="choose-folder" class="folder-button">${icon("folder-open")}<span><small>SAVE TO</small><span id="folder-label"></span></span></button><button id="download" class="primary">${icon("arrow-down-to-line")} Download</button></div></div><div id="composer-hint" class="composer-hint">${icon("chrome")} Send the current video from your browser with the browser helper.</div></section>
</section><section id="history-page" hidden><div class="page-heading"><div><h1>Your downloads</h1><p id="queue-summary">All your downloads in one place.</p></div><button class="secondary" id="history-new">${icon("plus")} New download</button></div><div class="history-filters" aria-label="Filter downloads"><button data-filter="all" aria-pressed="true">All</button><button data-filter="active" aria-pressed="false">In progress</button><button data-filter="completed" aria-pressed="false">Completed</button><button data-filter="attention" aria-pressed="false">Needs attention</button></div><div class="list-heading"><h2>Showing <span id="active-count">0</span></h2><div class="queue-tools"><button id="resume-all" class="secondary" hidden>Resume stopped downloads</button><button id="clear-history" class="secondary">Clear finished</button></div></div><label class="search-box">${icon("search")}<input id="search" placeholder="Search title or website" aria-label="Search downloads"></label><div id="history-list"></div><div class="tip"><span>${icon("circle-help")}</span><p>Downloads continue when you close this window.</p></div></section>
<section id="settings-page" hidden><div class="page-heading"><div><h1>Settings</h1><p>Updates, browser integration, and download tools.</p></div></div><section class="setup-card"><h2>Download performance</h2><label for="fragment-concurrency">Parallel video parts</label><select id="fragment-concurrency"><option value="8">8 parts · Faster (recommended)</option><option value="4">4 parts · Balanced</option><option value="1">1 part · Compatibility</option></select><p class="hint">Downloads several parts of a video at once on supported sites. Applies to new downloads; direct files and FFmpeg section downloads may not benefit. If a site fails or slows down, try fewer parts.</p><p id="performance-saved" role="status"></p></section><section class="setup-card"><h2>App updates <span id="app-version"></span></h2><label class="update-toggle"><input type="checkbox" id="auto-updates"> Automatically download and install updates</label><p class="hint">Installs when downloads are finished and this window is closed. Your history and preferences are kept.</p><p id="update-status" role="status">Checking update settings...</p><div class="update-actions"><button id="check-update" class="secondary">Check for updates</button><button id="install-update" class="primary" hidden>Update now</button></div></section><div class="page-heading"><div><h1>Browser helper</h1><p>One click in your browser brings the current video to SmowaDL.</p></div></div><section class="setup-card"><div class="setup-icon">${icon("chrome")}</div><h2>Connect Brave or Chrome</h2><p>Load the included extension in Brave or Chrome once. Windows app links connect it automatically.</p><ol><li>Open <code>brave://extensions</code> (or <code>chrome://extensions</code>) and enable <strong>Developer mode</strong>.</li><li>Click <strong>Load unpacked</strong> and select the <code>extension</code> folder beside SmowaDL.exe.</li><li>Pin SmowaDL to the toolbar and click it on a video page.</li></ol><details class="legacy-helper"><summary>Legacy extension connection</summary><p class="hint">Only needed for older extensions.</p><label for="extension-id">Legacy browser extension ID</label><div class="url-row"><input id="extension-id" placeholder="32-letter extension ID" maxlength="32"><button id="connect" class="primary">Connect helper</button></div><p id="connect-result" role="status"></p></details><div class="hint">Pin SmowaDL to your browser toolbar. Click it on a video to open the download options, even when the app is closed.</div></section><section class="setup-card"><h2>Download engine</h2><p>yt-dlp downloads media. FFmpeg merges, trims and converts it. Node.js runs JavaScript that yt-dlp needs for sites such as YouTube; it is a helper, not a separate downloader. Tools check for the latest stable releases at startup and daily when downloads are idle.</p><div id="health" class="health"></div><div id="tool-stages" class="tool-stages" aria-live="polite"></div><p class="hint">If a site changes, use Set up / update tools below. Some private or restricted videos require authentication and are not supported by this version.</p><button id="check-tools" class="secondary">Check tools</button> <button id="setup-tools" class="secondary">Set up / update tools</button></section></section></div><footer><span><span class="status-dot"></span> <span id="footer-status">Ready when you are</span></span><span>Files stay on your computer</span></footer></main><div id="toast" class="toast" role="status" hidden></div>`;

// Keep common choices prominent, with technical preferences available on demand.
const advanced = document.createElement("details");
advanced.className = "advanced-options";
advanced.innerHTML = '<summary>Advanced options <span>Codec and quality preferences</span></summary><div class="advanced-grid"></div>';
$("quality-hint").before(advanced);
advanced.querySelector("div")!.append($("codec").parentElement!, $("quality").parentElement!);
const trim = new TrimEditor($("clip-fields"));
const parallel = $<HTMLSelectElement>("fragment-concurrency");
const storedParallel = localStorage.getItem("fragment-concurrency");
parallel.value = storedParallel && ["1", "4", "8"].includes(storedParallel) ? storedParallel : "8";
parallel.onchange = () => {
  localStorage.setItem("fragment-concurrency", parallel.value);
  $("performance-saved").textContent = "Saved. Applies to new downloads.";
};
let preferences: Record<string, string> = {};
try { const saved = JSON.parse(localStorage.getItem("download-preferences") || "{}"); if (saved && typeof saved === "object" && !Array.isArray(saved)) preferences = saved; } catch {}
function rememberOptions() {
  for (const id of ["format", "resolution", "codec", "quality"]) preferences[id] = $<HTMLSelectElement>(id).value;
  localStorage.setItem("download-preferences", JSON.stringify(preferences));
}
function restoreOptions() {
  for (const id of ["format", "resolution", "codec"]) {
    const control = $<HTMLSelectElement>(id);
    if (Array.from(control.options).some(o => o.value === preferences[id] && !o.disabled)) control.value = preferences[id];
  }
  updateFormat();
  const quality = $<HTMLSelectElement>("quality");
  if (Array.from(quality.options).some(o => o.value === preferences.quality)) quality.value = preferences.quality;
}
for (const id of ["format", "resolution", "codec", "quality"]) $(id).addEventListener("change", () => { if (id === "format") updateFormat(); rememberOptions(); $("download-error").hidden = true; });

type Draft = { media: Video; values: Record<string, string>; clip: boolean; folder: string; advanced: boolean };
const drafts: Draft[] = [];
function incomingUI() {
  $("incoming-links").hidden = !pending.length && !drafts.length;
  $("incoming-summary").textContent = `${pending.length} browser link${pending.length === 1 ? "" : "s"} waiting${drafts.length ? ` · ${drafts.length} saved draft${drafts.length === 1 ? "" : "s"}` : ""}`;
  $("incoming-next").hidden = !pending.length;
  $<HTMLButtonElement>("incoming-next").disabled = analyzing;
  $("restore-draft").hidden = !drafts.length;
  $<HTMLButtonElement>("restore-draft").disabled = analyzing;
}
function saveDraft(): Draft | null {
  if (!video) return null;
  return {media: video, values: Object.fromEntries(["format","resolution","codec","quality","clip-start","clip-end"].map(id => [id, $<HTMLInputElement>(id).value])), clip: $<HTMLInputElement>("clip-enabled").checked, folder, advanced: advanced.open};
}
async function openIncoming() {
  if (analyzing || !pending.length) return;
  const draft = saveDraft(); if (draft) drafts.push(draft);
  else if ($<HTMLInputElement>("url").value.trim()) pending.push($<HTMLInputElement>("url").value.trim());
  const url = pending.shift()!; navigate("downloads"); $<HTMLInputElement>("url").value = url;
  await analyze(url); incomingUI();
}
$("incoming-next").onclick = () => void openIncoming();
$("restore-draft").onclick = async () => {
  if (analyzing) return;
  const draft = drafts.shift(); if (!draft) return;
  const current = saveDraft(); if (current) drafts.push(current);
  navigate("downloads"); $<HTMLInputElement>("url").value = draft.media.url;
  await analyze(draft.media.url, draft.media);
  $<HTMLSelectElement>("format").value = draft.values.format; updateFormat();
  for (const id of ["resolution","codec","quality"]) $<HTMLSelectElement>(id).value = draft.values[id];
  trim.restoreSelection(draft.values["clip-start"], draft.values["clip-end"]);
  $<HTMLInputElement>("clip-enabled").checked = draft.clip; $("clip-fields").hidden = !draft.clip;
  folder = draft.folder; updateFolder(); advanced.open = draft.advanced;
  trim.toggle(draft.clip); updateFormat(); incomingUI();
};
$("resume-all").onclick = async () => { try { await call("resume_all"); await refresh(); } catch(e) { notify(String(e), true); } };
function navigate(next: string) {
  page = next;
  $("settings-page").hidden = page !== "settings";
  $("downloads-page").hidden = page !== "downloads";
  $("history-page").hidden = page !== "history";
  trim.toggle(page === "downloads" && $<HTMLInputElement>("clip-enabled").checked);
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
document.querySelectorAll<HTMLButtonElement>("[data-page]").forEach(button => {
  button.onclick = () => { navigate(button.dataset.page!); window.scrollTo({top: 0}); };
});
$("focus-url").onclick = () => {
  if (analyzing) return;
  video = null; trim.reset();
  $("options").hidden = true; $("video-info").hidden = true;
  $("analyze-error").hidden = true; $("composer-hint").hidden = false;
  $<HTMLInputElement>("url").value = "";
  $<HTMLInputElement>("url").focus();
};
$("history-new").onclick = () => { navigate("downloads"); $("url").focus(); };
document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach(button => {
  button.onclick = () => { statusFilter = button.dataset.filter!; renderJobs(); };
});
document.addEventListener("keydown", e => {
  if (e.ctrlKey && e.key.toLowerCase() === "l") { e.preventDefault(); navigate("downloads"); $<HTMLInputElement>("url").select(); }
});
$("search").oninput = () => {
  filter = $<HTMLInputElement>("search").value.toLowerCase();
  renderJobs();
};
$("clear-history").onclick = async () => {
  if (
    !confirm(
      "Clear completed, failed and cancelled entries from history? Paused and interrupted downloads will be kept. Your downloaded files will be kept.",
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
      (j) => `${j.title} ${j.url}`.toLowerCase().includes(filter) &&
        (statusFilter === "all" || (statusFilter === "active" ? active(j) : statusFilter === "completed" ? j.status === "completed" : ["failed", "cancelled", "interrupted", "paused"].includes(j.status))),
    );
  history.sort((a, b) => {
    const rank = (j: Job) => ["downloading","processing"].includes(j.status) ? 0 : j.status === "queued" ? 1 : 2;
    return rank(a)-rank(b) || (a.status === "queued" && b.status === "queued" ? (a.queue_order || a.created)-(b.queue_order || b.created) : b.created-a.created);
  });
  $("resume-all").hidden = !jobs.some(j => ["paused","interrupted"].includes(j.status));
  const focused = document.activeElement as HTMLElement | null;
  const focusAction = focused?.dataset.action, focusId = focused?.dataset.id, focusDirection = focused?.dataset.direction;
  const expanded = new Set(Array.from(document.querySelectorAll<HTMLDetailsElement>("#history-list details[open]")).map(el => el.closest<HTMLElement>("[data-job]")?.dataset.job));
  $("queue-summary").textContent = `${queue.length} in progress · ${jobs.filter(j => j.status === "completed").length} completed`;
  document.querySelectorAll<HTMLButtonElement>("[data-filter]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.filter === statusFilter)));
  $<HTMLButtonElement>("clear-history").disabled = !jobs.some(j => !active(j) && !["paused","interrupted"].includes(j.status));
  $("active-count").textContent = String(history.length);
  $("queue-count").textContent = String(queue.length);
  $("queue-count").hidden = !queue.length;
  $("footer-status").textContent = queue.length
    ? `${queue.length} download${queue.length === 1 ? "" : "s"} in queue`
    : "Ready when you are";
  $("history-list").innerHTML = history.length
    ? history.map(card).join("")
    : `<div class="empty-state"><div class="empty-icon">${icon("history")}</div><h3>${filter || statusFilter !== "all" ? "No downloads here" : "Your collection starts here"}</h3><p>${filter || statusFilter !== "all" ? "Try another filter or search." : "Queued, active and finished downloads appear here."}</p></div>`;
  document.querySelectorAll<HTMLButtonElement>("[data-action]").forEach(
    (b) =>
      (b.onclick = async () => {
        b.disabled = true;
        try {
          await call(b.dataset.action!, { id: b.dataset.id, ...(b.dataset.direction ? {direction: b.dataset.direction} : {}) });
          if (b.dataset.action === "copy_file") notify("File copied. Paste it into a folder or an app that accepts files.");
          await refresh();
        } catch (e) {
          notify(String(e), true);
        } finally {
          b.disabled = false;
        }
      }),
  );
  document.querySelectorAll<HTMLDetailsElement>("#history-list details").forEach(el => { el.open = expanded.has(el.closest<HTMLElement>("[data-job]")?.dataset.job); });
  if (focusAction && focusId) Array.from(document.querySelectorAll<HTMLButtonElement>("#history-list [data-action]")).find(b => b.dataset.action === focusAction && b.dataset.id === focusId && b.dataset.direction === focusDirection)?.focus({preventScroll:true});
  icons();
}
const bytes = (n: number) => n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GiB` : `${(n / 1048576).toFixed(1)} MiB`;
function card(j: Job) {
  let host = ""; try { host = new URL(j.url).hostname.replace("www.", ""); } catch {}
  const running = active(j), done = j.status === "completed";
  const button = (action: string, label: string, glyph: string, direction = "") => `<button class="icon-button" data-action="${action}" data-direction="${direction}" data-id="${esc(j.id)}" aria-label="${label}" title="${label}">${icon(glyph)}</button>`;
  const size = j.downloaded_bytes ? `${bytes(j.downloaded_bytes)}${j.total_bytes ? ` / ${j.total_estimated ? "~" : ""}${bytes(j.total_bytes)}` : ""}` : "";
  const progress = running && j.status !== "queued" ? `<progress max="100" ${j.status === "processing" || !j.total_bytes ? "" : `value="${j.percent}"`} aria-label="Download progress"></progress><div class="progress-label"><span>${esc(j.phase || (j.status === "queued" ? "Waiting in queue" : "Connecting"))}${j.status === "downloading" && j.speed && j.speed !== "NA" ? ` · ${esc(j.speed)}` : ""}</span><span>${j.status === "downloading" ? `${size}${j.total_bytes ? ` · ${j.percent.toFixed(1)}%` : ""}${j.eta && j.eta !== "NA" ? ` · ETA ${esc(j.eta)}` : ""}` : ""}</span></div>` : "";
  const reorder = j.status === "queued" ? `${button("reorder","Move earlier","arrow-up","up")}${button("reorder","Move later","arrow-down","down")}<button class="secondary next-job" data-action="reorder" data-direction="next" data-id="${j.id}">Download next</button>` : "";
  const resume = ["paused","interrupted"].includes(j.status);
  const actions = done ? button("copy_file","Copy file","copy") + button("reveal","Show in folder","folder-open") : running ? button("pause","Pause download","pause") + button("cancel","Cancel download","x") : button("retry",resume ? "Resume download" : "Retry download",resume ? "play" : "rotate-ccw");
  return `<article class="job" data-job="${esc(j.id)}"><div class="job-icon ${done ? "complete" : ""}">${icon(done ? "check" : "film")}</div><div class="job-body"><div class="job-top"><h3 title="${esc(j.title)}">${esc(j.title || j.url)}</h3><span class="job-status ${esc(j.status)}">${esc(j.status)}</span></div><div class="job-meta">${esc(host)}<span>·</span>${esc(j.options.format.toUpperCase())}<span>·</span>${["mp3","m4a"].includes(j.options.format) ? "Audio" : j.options.resolution ? j.options.resolution + "p" : "Best resolution"}<span>·</span>${new Date(j.created * 1000).toLocaleDateString()}${j.options.start_time != null ? `<span>·</span>Clip ${j.options.start_time}s–${j.options.end_time}s` : ""}</div>${progress}${resume ? '<p class="hint">Partial downloads are kept. Some sources or conversion steps may restart.</p>' : ""}${j.error ? `<details><summary>Download details</summary><pre>${esc(j.error)}</pre></details>` : ""}${reorder ? `<div class="queue-order">${reorder}</div>` : ""}</div><div class="job-actions">${actions}</div></article>`;
}

$("analyze-form").onsubmit = async (e) => {
  e.preventDefault();
  await analyze($<HTMLInputElement>("url").value);
};
async function analyze(url: string, restored?: Video) {
  if (analyzing) return;
  analyzing = true;
  video = null;
  trim.reset();
  $("options").hidden = true;
  $("video-info").hidden = true;
  $("composer-hint").hidden = true;
  $("analyze-error").hidden = true;
  $("download-error").hidden = true;
  $<HTMLButtonElement>("analyze").disabled = true;
  $<HTMLButtonElement>("focus-url").disabled = true;
  $("analyze").textContent = "Getting video…";
  try {
    video = restored || await call<Video>("inspect_video", { url });
    $<HTMLInputElement>("clip-enabled").checked = false;
    $("clip-fields").hidden = true;
    trim.setMedia(video);
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
    restoreOptions();
    updateFolder();
    icons();
  } catch (e) {
    $("analyze-error").textContent = String(e);
    $("analyze-error").hidden = false;
    $("composer-hint").hidden = false;
  } finally {
    analyzing = false;
    incomingUI();
    $<HTMLButtonElement>("focus-url").disabled = false;
    $<HTMLButtonElement>("analyze").disabled = engineBusy;
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
  const format = $<HTMLSelectElement>("format").value;
  const audio = ["mp3", "m4a"].includes(format);
  const quality = $<HTMLSelectElement>("quality");
  if (quality.dataset.format !== format) {
    const previous = quality.value;
    const choices = audio
      ? [["best", "Best source quality"], [format === "mp3" ? "320K" : "256K", format === "mp3" ? "320 kbps when converting" : "256 kbps when converting"], ["192K", "192 kbps when converting"], ["128K", "128 kbps when converting"]]
      : [["best", "Best available"], ["balanced", "Balanced · prefer 30 fps"], ["small", "Smaller · lower bitrate"]];
    quality.innerHTML = choices.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
    quality.value = choices.some(([value]) => value === previous) ? previous : "best";
    quality.dataset.format = format;
  }
  $("quality-label").textContent = audio ? "Audio encoding" : "Quality";
  $("resolution").parentElement!.hidden = audio;
  $("codec").parentElement!.hidden = audio;
  document.querySelector(".option-grid")!.classList.toggle("audio-options", audio);
  const qualityField = $("quality").parentElement!;
  if (audio) document.querySelector(".option-grid")!.append(qualityField);
  else advanced.querySelector("div")!.append(qualityField);
  advanced.hidden = audio;
  $<HTMLSelectElement>("resolution").disabled = audio;
  $<HTMLSelectElement>("codec").disabled = audio;
  $("quality-hint").textContent = audio
    ? "Matching audio is kept without conversion. Bitrate applies when conversion is needed; higher values cannot restore missing detail."
    : $<HTMLInputElement>("clip-enabled").checked
      ? "Exact section cuts may re-encode video. Resolution and codec select the source streams."
      : "Original streams, no video re-encoding. Resolution is a maximum; availability depends on the video.";
}

function parseTimestamp(value: string): number {
  const text = value.trim();
  if (!/^\d+(?::[0-5]?\d){0,2}(?:\.\d{1,3})?$/.test(text)) throw Error("Use seconds, mm:ss or hh:mm:ss for timestamps.");
  const seconds = text.split(":").reduce((total, part) => total * 60 + Number(part), 0);
  if (!Number.isFinite(seconds)) throw Error("Invalid timestamp.");
  return seconds;
}
$("clip-enabled").onchange = () => { const enabled = $<HTMLInputElement>("clip-enabled").checked; $("clip-fields").hidden = !enabled; trim.toggle(enabled); updateFormat(); };
$("download").onclick = async () => {
  if (!video || busy) return;
  $("download-error").hidden = true;
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
      fragment_concurrency: Number(parallel.value),
      url: video.url,
      resolution: Number($<HTMLSelectElement>("resolution").value),
      codec: $<HTMLSelectElement>("codec").value,
      format: $<HTMLSelectElement>("format").value,
      quality: $<HTMLSelectElement>("quality").value,
      folder,
    };
    await call("start_download", { options, title: video.title });
    filter = ""; statusFilter = "all";
    $<HTMLInputElement>("search").value = "";
    renderJobs();
    notify("Added to downloads");
    navigate("history");
    await refresh();
    $("history-list").scrollIntoView({ block: "nearest" });
  } catch (e) {
    $("download-error").textContent = String(e);
    $("download-error").hidden = false;
    $("download-error").scrollIntoView({block:"nearest"});
  } finally {
    busy = false;
    $<HTMLButtonElement>("download").disabled = engineBusy;
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
    const [status, engine, details] = await Promise.all([call<UpdateStatus>("update_status"), call<string>("engine_status"), call<{busy:boolean;tools:{name:string;stage:string}[]}>("engine_details")]);
    if (details) { engineBusy = details.busy; $<HTMLButtonElement>("analyze").disabled = analyzing || engineBusy; $<HTMLButtonElement>("download").disabled = busy || engineBusy; $("tool-stages").innerHTML = details.tools.map(t => `<div><strong>${esc(t.name)}</strong><span>${esc(t.stage)}</span></div>`).join(""); $<HTMLButtonElement>("setup-tools").disabled = details.busy; }
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
    incomingUI();
    if (pending.length && !engineBusy && !analyzing && !video && !$<HTMLInputElement>("url").value.trim()) {
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
      await refreshUpdates();
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
