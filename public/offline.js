// Shared network helpers for bad festival signal: request timeouts, a last-good
// copy of each GET kept in localStorage, a freshness label, and polling that
// pauses while the app is in the background. Also registers the service worker.
(function () {
  const TIMEOUT_MS = 8000;
  const CACHE_PREFIX = "acl_cache_v1:";

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
  }

  // fetch() that gives up after TIMEOUT_MS so a jammed tower doesn't hang the UI.
  // Network failures throw an Error with .offline = true.
  async function request(url, opts) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      return await fetch(url, { ...opts, signal: ctl.signal });
    } catch (e) {
      const err = new Error("No signal — try again");
      err.offline = true;
      throw err;
    } finally {
      clearTimeout(t);
    }
  }

  // Last-good copy of a GET: { data, t } or null.
  function cached(url) {
    try { return JSON.parse(localStorage.getItem(CACHE_PREFIX + url)); } catch (e) { return null; }
  }

  // GET JSON. -> { data, t, fresh }. Falls back to the last-good copy (fresh: false)
  // when the network fails; throws only if there's nothing saved.
  async function getJSON(url) {
    try {
      const res = await request(url);
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const t = Date.now();
      try { localStorage.setItem(CACHE_PREFIX + url, JSON.stringify({ data, t })); } catch (e) {}
      return { data, t, fresh: true };
    } catch (e) {
      const c = cached(url);
      if (c) return { data: c.data, t: c.t, fresh: false };
      throw e;
    }
  }

  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  // "Updated 2:14 PM" / "Offline · showing 2:10 PM" / "Updating… · showing 2:10 PM".
  function showStatus(el, { t, fresh, pending }) {
    if (!el) return;
    el.textContent = fresh ? `Updated ${clock(t)}` : `${pending ? "Updating…" : "Offline"} · showing ${clock(t)}`;
    el.classList.toggle("offline", !fresh && !pending);
  }

  // Run fn every ms while the page is visible, plus right away whenever the app
  // comes back to the foreground or the connection returns. skip() can veto a tick.
  function poll(fn, ms, skip) {
    const tick = () => { if (!document.hidden && !(skip && skip())) fn(); };
    setInterval(tick, ms);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("online", tick);
  }

  window.ACLNet = { request, cached, getJSON, showStatus, poll };
})();
