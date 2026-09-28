(() => {
  const buttons = new Map();
  function mediaUrl(video) {
    const host = location.hostname;
    if (host.endsWith('youtube.com')) {
      const shorts = video.closest('ytd-reel-video-renderer');
      if (shorts) return shorts.querySelector('a[href*="/shorts/"]')?.href || (shorts.hasAttribute('is-active') && location.pathname.startsWith('/shorts/') ? location.href : null);
      return video.closest('#movie_player') && location.pathname === '/watch' && new URL(location.href).searchParams.has('v') ? location.href : null;
    }
    if (host.endsWith('x.com') || host.endsWith('twitter.com')) {
      const tweet = video.closest('article[data-testid="tweet"]');
      return tweet?.querySelector('a[href*="/status/"] time')?.closest('a')?.href || null;
    }
    if (host.endsWith('instagram.com')) {
      const post = video.closest('article');
      return post?.querySelector('a[href*="/p/"],a[href*="/reel/"]')?.href || (/^\/(p|reel)\/[^/]+/.test(location.pathname) && document.querySelectorAll('video').length === 1 ? location.href : null);
    }
    if (host.endsWith('tiktok.com')) {
      const card = video.closest('[data-e2e="recommend-list-item-container"], [data-e2e="user-post-item"], article');
      return card?.querySelector('a[href*="/video/"]')?.href || (/\/video\/\d+/.test(location.pathname) && document.querySelectorAll('video').length === 1 ? location.href : null);
    }
    return null;
  }
  function scan() {
    for (const [video, item] of buttons) if (!video.isConnected) { item.host.remove(); buttons.delete(video); }
    for (const video of document.querySelectorAll('video')) {
      const url = mediaUrl(video);
      if (!url) { const old = buttons.get(video); if (old) { old.host.remove(); buttons.delete(video); } continue; }
      let item = buttons.get(video);
      if (!item) {
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;z-index:2147483646;display:none;width:30px;height:30px;';
        const root = host.attachShadow({mode:'closed'});
        root.innerHTML = `<style>a{display:grid;place-items:center;width:30px;height:30px;border:1px solid #ffffff40;border-radius:7px;background:#16181dcc;color:#eee;opacity:.65;box-sizing:border-box;transition:opacity .15s}a:hover,a:focus-visible{opacity:1;background:#262a33}a:focus-visible{outline:2px solid #6cc0f2;outline-offset:2px}svg{width:17px;height:17px}</style><a title="Download with SmowaDL" aria-label="Download with SmowaDL"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></svg></a>`;
        const a = root.querySelector('a');
        a.addEventListener('click', e => e.stopPropagation());
        document.documentElement.append(host);
        item = {host, a}; buttons.set(video, item);
      }
      item.a.href = 'smowadl://download?url=' + encodeURIComponent(url);
    }
    position();
  }
  function position() {
    for (const [video, {host}] of buttons) {
      const r = video.getBoundingClientRect();
      const visible = !document.fullscreenElement && r.width >= 160 && r.height >= 100 && r.top >= -r.height + 50 && r.top < innerHeight - 40 && r.right > 40 && r.right <= innerWidth + 10;
      host.style.display = visible ? 'block' : 'none';
      host.style.left = Math.min(innerWidth - 38, r.right - 38) + 'px';
      host.style.top = Math.max(8, r.top + 8) + 'px';
    }
  }
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => { scheduled = false; scan(); }, 250);
  }).observe(document.documentElement, {childList:true, subtree:true});
  addEventListener('scroll', position, {passive:true, capture:true});
  addEventListener('resize', position, {passive:true});
  document.addEventListener('fullscreenchange', position);
  addEventListener('popstate', scan);
  scan();
})();
