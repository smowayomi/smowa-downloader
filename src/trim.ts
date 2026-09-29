type Media = { duration: number; thumbnail: string; audioOnly?: boolean; formats: { url?: string; protocol?: string; ext?: string; height?: number; vcodec?: string; acodec?: string }[] };
const time = (seconds: number) => {
  const ms = Math.round(seconds * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}${ms % 1000 ? `.${String(ms % 1000).padStart(3, "0")}` : ""}`;
};
const parse = (value: string) => /^\d+(?::[0-5]?\d){0,2}(?:\.\d{1,3})?$/.test(value.trim()) ? value.trim().split(":").reduce((n, v) => n * 60 + Number(v), 0) : NaN;

export class TrimEditor {
  private duration = 0;
  private start = 0;
  private end = 0;
  private sources: string[] = [];
  private source = 0;
  private selectionPlaying = false;
  private loaded = false;
  private enabled = false;
  private timeout?: ReturnType<typeof setTimeout>;
  private zoomStart = 0;
  private zoomEnd = 0;
  private player: HTMLVideoElement;
  private get = <T extends HTMLElement>(id: string) => this.root.querySelector<T>(`#${id}`)!;
  constructor(private root: HTMLElement) {
    root.innerHTML = `<div class="trim-preview"><video id="clip-preview" controls playsinline preload="metadata" aria-label="Media preview"></video><p id="preview-status" role="status">Preview loads when you open the section editor.</p><button id="preview-retry" class="secondary" hidden>Retry preview</button></div>
      <div class="trim-heading"><strong>Choose your section</strong><output id="clip-duration"></output></div>
      <div class="trim-zoom"><button id="trim-zoom-in" class="secondary">Zoom in</button><button id="trim-zoom-out" class="secondary">Zoom out</button><button id="trim-zoom-full" class="secondary">Full video</button><button id="trim-pan-left" class="secondary" aria-label="Earlier in timeline">←</button><button id="trim-pan-right" class="secondary" aria-label="Later in timeline">→</button></div>
      <div class="trim-timeline"><div class="trim-track"><div id="trim-selection"></div></div><input id="trim-start-handle" type="range" min="0" max="1" step="0.01" value="0" aria-label="Section start"><input id="trim-end-handle" type="range" min="0" max="1" step="0.01" value="1" aria-label="Section end"></div>
      <div class="trim-scale"><span id="trim-origin">0:00</span><span id="trim-total"></span></div>
      <div class="trim-times"><label>Start<input id="clip-start" value="0:00" inputmode="decimal" aria-describedby="clip-hint"></label><button id="trim-set-start" class="secondary">Use current time</button><label>End<input id="clip-end" inputmode="decimal" aria-describedby="clip-hint"></label><button id="trim-set-end" class="secondary">Use current time</button></div>
      <div class="trim-actions"><button id="trim-play" class="secondary">Play selection</button><button id="trim-back" class="secondary" aria-label="Seek back 0.1 seconds">−0.1s</button><button id="trim-forward" class="secondary" aria-label="Seek forward 0.1 seconds">+0.1s</button><span id="trim-position">Current: 0:00</span></div><p id="trim-error" class="inline-error" role="alert" hidden></p><p id="clip-hint" class="hint">Drag the handles, or enter exact times (mm:ss). Arrow keys fine-tune by 0.01s. Exact cuts may take longer; some sites transfer the full source.</p>`;
    this.player = this.get("clip-preview");
    for (const side of ["start", "end"] as const) {
      this.get<HTMLInputElement>(`trim-${side}-handle`).oninput = (event) => this.move(side, Number((event.target as HTMLInputElement).value));
      this.get<HTMLInputElement>(`clip-${side}`).onchange = (event) => {
        const value = parse((event.target as HTMLInputElement).value);
        if (!Number.isFinite(value) || value < 0 || (this.duration && value > this.duration) || (side === "start" ? value >= this.end : value <= this.start)) {
          this.get("trim-error").textContent = "Enter a valid time within the video, with end after start.";
          this.get("trim-error").hidden = false;
          return;
        }
        this.move(side, value);
      };
      this.get(`trim-set-${side}`).onclick = () => this.move(side, this.player.currentTime);
    }
    this.get("trim-play").onclick = async () => {
      if (this.selectionPlaying) { this.player.pause(); return; }
      this.player.currentTime = this.start;
      this.selectionPlaying = true;
      try { await this.player.play(); this.get("trim-play").textContent = "Pause selection"; }
      catch { this.selectionPlaying = false; this.status("Preview could not play. You can still choose the section below."); }
    };
    this.player.onpause = () => { this.selectionPlaying = false; this.get("trim-play").textContent = "Play selection"; };
    this.player.ontimeupdate = () => {
      this.get("trim-position").textContent = `Current: ${time(this.player.currentTime)}`;
      if (this.selectionPlaying && this.player.currentTime >= this.end) { this.player.pause(); this.player.currentTime = this.end; }
    };
    this.player.onloadedmetadata = () => {
      if (!this.duration && Number.isFinite(this.player.duration)) { this.duration = this.player.duration; this.end = this.duration; this.zoomEnd = this.duration; this.render(); }
    };
    this.player.oncanplay = () => {
      if (!this.enabled) return;
      clearTimeout(this.timeout); this.loaded = true; this.status(""); this.playbackButtons(true);
      this.get("preview-retry").hidden = true;
    };
    this.player.onwaiting = () => { if (this.enabled) this.armTimeout(); };
    this.player.onplaying = () => clearTimeout(this.timeout);
    this.player.onerror = () => { if (this.enabled && this.player.getAttribute("src")) this.failedSource(); };
    this.get("preview-retry").onclick = () => { this.source = 0; this.loadSource(); };
    this.get("trim-zoom-in").onclick = () => this.zoom(0.5);
    this.get("trim-zoom-out").onclick = () => this.zoom(2);
    this.get("trim-zoom-full").onclick = () => { this.zoomStart = 0; this.zoomEnd = this.duration; this.render(); };
    for (const [id, direction] of [["trim-pan-left", -1], ["trim-pan-right", 1]] as const) {
      this.get(id).onclick = () => {
        const width = this.zoomEnd - this.zoomStart;
        this.zoomStart = Math.max(0, Math.min(this.duration - width, this.zoomStart + direction * width * 0.5));
        this.zoomEnd = this.zoomStart + width; this.render();
      };
    }
    for (const [id, delta] of [["trim-back", -0.1], ["trim-forward", 0.1]] as const) {
      this.get(id).onclick = () => { this.player.pause(); this.player.currentTime = Math.max(0, Math.min(this.duration || this.player.duration, this.player.currentTime + delta)); };
    }
  }
  private armTimeout() {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      this.player.pause(); this.player.removeAttribute("src"); this.player.load(); this.loaded = false;
      this.playbackButtons(false);
      this.status("Preview timed out. Retry, or choose your section using the timeline and exact times.");
      this.get("preview-retry").hidden = !this.sources.length;
    }, 15000);
  }
  private loadSource() {
    if (!this.enabled || !this.sources.length) return;
    this.loaded = false; this.playbackButtons(false); this.get("preview-retry").hidden = true;
    this.status("Loading preview…"); this.player.src = this.sources[this.source]; this.armTimeout();
  }
  private failedSource() {
    clearTimeout(this.timeout);
    if (++this.source < this.sources.length) this.loadSource();
    else {
      this.loaded = false; this.playbackButtons(false);
      this.status("Preview unavailable. Retry, or use the timeline and exact times. Fetch the video again if its preview link has expired.");
      this.get("preview-retry").hidden = false;
    }
  }
  private zoom(factor: number) {
    const width = Math.min(this.duration, Math.max(Math.min(1, this.duration), (this.zoomEnd - this.zoomStart) * factor));
    const center = this.loaded ? this.player.currentTime : (this.start + this.end) / 2;
    this.zoomStart = Math.max(0, Math.min(this.duration - width, center - width / 2));
    this.zoomEnd = this.zoomStart + width; this.render();
  }
  restoreSelection(start: string, end: string) {
    const a = parse(start), b = parse(end);
    if (Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b > a && (!this.duration || b <= this.duration)) { this.start = a; this.end = b; this.render(); }
  }
  private status(message: string) { this.get("preview-status").textContent = message; this.get("preview-status").hidden = !message; }
  private playbackButtons(enabled: boolean) { for (const id of ["trim-play", "trim-set-start", "trim-set-end", "trim-back", "trim-forward"]) this.get<HTMLButtonElement>(id).disabled = !enabled; }
  reset() {
    this.enabled = false; clearTimeout(this.timeout); this.get("preview-retry").hidden = true;
    this.player.pause(); this.player.removeAttribute("src"); this.player.load(); this.sources = []; this.source = 0; this.loaded = false; this.playbackButtons(false);
  }
  setMedia(media: Media) {
    this.duration = Number.isFinite(media.duration) ? Math.max(0, media.duration) : 0;
    this.start = 0; this.end = this.duration; this.zoomStart = 0; this.zoomEnd = this.duration;
    this.player.poster = media.thumbnail?.startsWith("https:") ? media.thumbnail : "";
    const candidates = (media.formats || []).filter(f => f.url?.startsWith("https:") && (!f.protocol || f.protocol === "https") && (media.audioOnly ? ["m4a", "mp3", "webm"].includes(f.ext || "") : ["mp4", "webm"].includes(f.ext || "") && f.vcodec !== "none"));
    // Prefer a small combined stream, then silent video. The download format is independent.
    candidates.sort((a, b) => Number(a.acodec === "none") - Number(b.acodec === "none") || Math.abs((a.height || 360) - 360) - Math.abs((b.height || 360) - 360));
    this.sources = [...new Set(candidates.map(f => f.url!))].slice(0, 4);
    this.player.hidden = !this.sources.length;
    this.render();
  }
  toggle(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) { clearTimeout(this.timeout); this.player.pause(); return; }
    if ((!this.player.getAttribute("src") || !this.loaded) && this.sources.length) { this.source = 0; this.loadSource(); }
    else if (!this.sources.length) this.status("This site does not offer a playable preview. You can still trim with the timeline or exact times.");
  }
  private move(side: "start" | "end", value: number) {
    if (side === "start") this.start = Math.max(0, Math.min(value, this.end - 0.01));
    else this.end = Math.max(this.start + 0.01, this.duration ? Math.min(value, this.duration) : value);
    this.player.pause();
    if (this.loaded) this.player.currentTime = side === "start" ? this.start : this.end;
    this.render();
  }
  private render() {
    this.get("trim-error").hidden = true;
    this.get<HTMLInputElement>("clip-start").value = time(this.start);
    this.get<HTMLInputElement>("clip-end").value = this.end ? time(this.end) : "";
    for (const side of ["start", "end"] as const) {
      const handle = this.get<HTMLInputElement>(`trim-${side}-handle`);
      handle.min = String(this.zoomStart); handle.max = String(this.zoomEnd || 1); handle.value = String(this[side]); handle.disabled = !this.duration;
      handle.setAttribute("aria-valuetext", time(this[side]));
    }
    const selection = this.get("trim-selection");
    const width = this.zoomEnd - this.zoomStart;
    const position = (value: number) => width ? Math.max(0, Math.min(100, (value - this.zoomStart) / width * 100)) : 0;
    selection.style.left = `${position(this.start)}%`;
    selection.style.right = `${100 - position(this.end)}%`;
    for (const id of ["trim-zoom-in", "trim-zoom-out", "trim-zoom-full", "trim-pan-left", "trim-pan-right"]) this.get<HTMLButtonElement>(id).disabled = !this.duration;
    this.get<HTMLButtonElement>("trim-zoom-in").disabled = !this.duration || width <= 1;
    this.get<HTMLButtonElement>("trim-zoom-out").disabled = !this.duration || width >= this.duration;
    this.get<HTMLButtonElement>("trim-pan-left").disabled = this.zoomStart <= 0;
    this.get<HTMLButtonElement>("trim-pan-right").disabled = this.zoomEnd >= this.duration;
    this.get("trim-origin").textContent = time(this.zoomStart);
    this.get("clip-duration").textContent = this.end ? `${time(this.end - this.start)} selected` : "Enter an end time";
    this.get("trim-total").textContent = this.duration ? time(this.zoomEnd) : "Duration unavailable";
  }
}
