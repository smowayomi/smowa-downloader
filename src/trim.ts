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
  private player: HTMLVideoElement;
  private get = <T extends HTMLElement>(id: string) => this.root.querySelector<T>(`#${id}`)!;
  constructor(private root: HTMLElement) {
    root.innerHTML = `<div class="trim-preview"><video id="clip-preview" controls playsinline preload="metadata" aria-label="Media preview"></video><p id="preview-status" role="status">Preview loads when you open the section editor.</p></div>
      <div class="trim-heading"><strong>Choose your section</strong><output id="clip-duration"></output></div>
      <div class="trim-timeline"><div class="trim-track"><div id="trim-selection"></div></div><input id="trim-start-handle" type="range" min="0" max="1" step="0.01" value="0" aria-label="Section start"><input id="trim-end-handle" type="range" min="0" max="1" step="0.01" value="1" aria-label="Section end"></div>
      <div class="trim-scale"><span>0:00</span><span id="trim-total"></span></div>
      <div class="trim-times"><label>Start<input id="clip-start" value="0:00" inputmode="decimal" aria-describedby="clip-hint"></label><button id="trim-set-start" class="secondary">Use current time</button><label>End<input id="clip-end" inputmode="decimal" aria-describedby="clip-hint"></label><button id="trim-set-end" class="secondary">Use current time</button></div>
      <div class="trim-actions"><button id="trim-play" class="secondary">Play selection</button><span id="trim-position">Current: 0:00</span></div><p id="trim-error" class="inline-error" role="alert" hidden></p><p id="clip-hint" class="hint">Drag the handles, or enter exact times (mm:ss). Arrow keys fine-tune by 0.01s. Exact cuts may take longer; some sites transfer the full source.</p>`;
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
      this.loaded = true;
      if (!this.duration && Number.isFinite(this.player.duration)) { this.duration = this.player.duration; this.end = this.duration; this.render(); }
      this.status("");
      this.playbackButtons(true);
    };
    this.player.onerror = () => {
      if (++this.source < this.sources.length) this.player.src = this.sources[this.source];
      else { this.playbackButtons(false); this.status("This site does not offer a playable preview. You can still trim with the timeline or exact times."); }
    };
  }
  private status(message: string) { this.get("preview-status").textContent = message; this.get("preview-status").hidden = !message; }
  private playbackButtons(enabled: boolean) { for (const id of ["trim-play", "trim-set-start", "trim-set-end"]) this.get<HTMLButtonElement>(id).disabled = !enabled; }
  reset() {
    this.player.pause(); this.player.removeAttribute("src"); this.player.load(); this.sources = []; this.source = 0; this.loaded = false; this.playbackButtons(false);
  }
  setMedia(media: Media) {
    this.duration = Number.isFinite(media.duration) ? Math.max(0, media.duration) : 0;
    this.start = 0; this.end = this.duration;
    this.player.poster = media.thumbnail?.startsWith("https:") ? media.thumbnail : "";
    const candidates = (media.formats || []).filter(f => f.url?.startsWith("https:") && (!f.protocol || f.protocol === "https") && (media.audioOnly ? ["m4a", "mp3", "webm"].includes(f.ext || "") : ["mp4", "webm"].includes(f.ext || "") && f.vcodec !== "none"));
    // Prefer a small combined stream, then silent video. The download format is independent.
    candidates.sort((a, b) => Number(a.acodec === "none") - Number(b.acodec === "none") || Math.abs((a.height || 360) - 360) - Math.abs((b.height || 360) - 360));
    this.sources = [...new Set(candidates.map(f => f.url!))].slice(0, 4);
    this.player.hidden = !this.sources.length;
    this.render();
  }
  toggle(enabled: boolean) {
    if (!enabled) { this.player.pause(); return; }
    if (!this.player.getAttribute("src") && this.sources.length) { this.status("Loading preview..."); this.player.src = this.sources[0]; }
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
      handle.max = String(this.duration || 1); handle.value = String(this[side]); handle.disabled = !this.duration;
      handle.setAttribute("aria-valuetext", time(this[side]));
    }
    const selection = this.get("trim-selection");
    selection.style.left = `${this.duration ? this.start / this.duration * 100 : 0}%`;
    selection.style.right = `${this.duration ? (1 - this.end / this.duration) * 100 : 0}%`;
    this.get("clip-duration").textContent = this.end ? `${time(this.end - this.start)} selected` : "Enter an end time";
    this.get("trim-total").textContent = this.duration ? time(this.duration) : "Duration unavailable";
  }
}
