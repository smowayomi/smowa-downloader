// Short, interruptible motion. The DOM always holds the final interactive state.
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const running = new Map<Element, Animation>();
const ease = "cubic-bezier(.2,.75,.25,1)";
export function animate(element: Element, frames: Keyframe[], duration = 180) {
  running.get(element)?.cancel();
  if (reduced.matches || document.hidden || !element.getClientRects().length) return;
  const bounds = element.getBoundingClientRect();
  if (bounds.bottom < 0 || bounds.top > innerHeight) return;
  const animation = element.animate(frames, {duration, easing: ease});
  running.set(element, animation);
  const cleanup = () => { if (running.get(element) === animation) running.delete(element); };
  void animation.finished.then(cleanup, cleanup);
}
export function reveal(element: Element, distance = 0) {
  animate(element, [{opacity: 0, transform: `translateY(${distance}px)`}, {opacity: 1, transform: "none"}]);
}
function stopMotion() { for (const animation of running.values()) animation.cancel(); running.clear(); }
reduced.addEventListener("change", () => { if (reduced.matches) stopMotion(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) stopMotion(); });

export function tabMotion(nav: HTMLElement) {
  const indicator = document.createElement("span");
  indicator.className = "tab-indicator"; indicator.setAttribute("aria-hidden", "true");
  nav.prepend(indicator);
  let positioned = false;
  const position = (animated = false) => {
    const active = nav.querySelector<HTMLElement>("[aria-current=page]");
    if (!active) return;
    const before = indicator.getBoundingClientRect(), target = active.getBoundingClientRect(), parent = nav.getBoundingClientRect();
    running.get(indicator)?.cancel();
    Object.assign(indicator.style, {left: `${target.left - parent.left}px`, top: `${target.top - parent.top}px`, width: `${target.width}px`, height: `${target.height}px`});
    if (positioned && animated) animate(indicator, [{transform: `translateX(${before.left - target.left}px) scaleX(${before.width / target.width})`}, {transform: "none"}], 210);
    positioned = true;
  };
  const resize = new ResizeObserver(() => position());
  resize.observe(nav); nav.querySelectorAll("button").forEach(button => resize.observe(button));
  position();
  return () => position(true);
}

export function observeReveals(root: HTMLElement) {
  const observer = new MutationObserver(records => {
    for (const element of new Set(records.map(record => record.target as HTMLElement))) {
      if (element.hidden) running.get(element)?.cancel();
      else reveal(element);
    }
  });
  root.querySelectorAll("#options, #video-info, #clip-fields, #incoming-links, #engine-banner, .inline-error").forEach(el => observer.observe(el, {attributes: true, attributeFilter: ["hidden"], attributeOldValue: true}));
}

// Only measure visible cards when their order changes, never on progress ticks.
export function cardPositions(list: HTMLElement) {
  return new Map(Array.from(list.querySelectorAll<HTMLElement>("[data-job]")).filter(el => {
    const r = el.getBoundingClientRect(); return r.height && r.bottom > 0 && r.top < innerHeight;
  }).map(el => [el.dataset.job!, el.getBoundingClientRect().top]));
}
export function moveCards(list: HTMLElement, before: Map<string, number>) {
  const moves = Array.from(list.querySelectorAll<HTMLElement>("[data-job]")).map(el => ({el, top: el.getBoundingClientRect().top, old: before.get(el.dataset.job!)}));
  for (const {el, top, old} of moves) {
    if (old != null && Math.abs(old - top) > 1 && Math.abs(old - top) < innerHeight && top < innerHeight) animate(el, [{transform:`translateY(${old - top}px)`}, {transform:"none"}], 220);
  }
}
