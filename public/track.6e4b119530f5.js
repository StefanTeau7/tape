// Personal links from our outreach emails (see /privacy and lib/outreach.js).
// Only a visit that arrived through such a link has the tape_t cookie; for every other
// visitor this script does nothing. Global Privacy Control turns it off too. Sent: the
// page path, video milestones, seconds the page was visible, and a waitlist sign-up
// (never the address). The code itself sits in an HttpOnly cookie this script can't read.
(() => {
  'use strict';
  if (!document.cookie.split('; ').includes('tape_t=1') || navigator.globalPrivacyControl) return;
  const send = (k, d) => {
    const body = JSON.stringify(d === undefined ? { k, p: location.pathname } : { k, p: location.pathname, d });
    try {
      if (!navigator.sendBeacon || !navigator.sendBeacon('/api/e', new Blob([body], { type: 'application/json' }))) {
        fetch('/api/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
      }
    } catch { /* tracking never breaks the page */ }
  };
  send('view');
  let since = document.visibilityState === 'visible' ? Date.now() : 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && since) { send('time', Math.round((Date.now() - since) / 1000)); since = 0; }
    else if (document.visibilityState === 'visible') since = Date.now();
  });
  for (const video of document.querySelectorAll('video[data-track]')) {
    const marks = [25, 50, 75, 100];
    let next = 0;
    video.addEventListener('play', () => send('video', 0), { once: true });
    video.addEventListener('timeupdate', () => {
      if (!video.duration) return;
      const pct = (video.currentTime / video.duration) * 100;
      while (next < marks.length && pct >= marks[next] - 1) send('video', marks[next++]);
    });
  }
  document.addEventListener('tape:joined', () => send('signup'));
})();
