// Map page: share live location, see friends on the festival map, drop a pin,
// and flash a "find me" beacon.
(function () {
  const NAME_KEY = "acl_name";       // same key the picker page uses
  const SEND_MS = 15000;
  const POLL_MS = 15000;

  const G = window.ACLGeo;
  let name = null;
  let watchId = null;
  let sendTimer = null;
  let lastFix = null;   // { lat, lon, accuracy, at }
  let lastSent = 0;
  let pinKind = null;  // null | "me" (drop my pin) | "meet" (set the meeting point)
  let meetup = null;   // { x, y, setBy, updatedAt } shared by everyone, or null
  let people = [];
  let serverSkew = 0;   // server now - client now
  let pendingAfterName = null;

  const els = {
    pinBtn: document.getElementById("pinBtn"),
    meetBtn: document.getElementById("meetBtn"),
    meetCard: document.getElementById("meetCard"),
    beaconBtn: document.getElementById("beaconBtn"),
    controls: document.getElementById("mapControls"),
    zoomInBtn: document.getElementById("zoomInBtn"),
    zoomOutBtn: document.getElementById("zoomOutBtn"),
    rotLeftBtn: document.getElementById("rotLeftBtn"),
    rotRightBtn: document.getElementById("rotRightBtn"),
    compassBtn: document.getElementById("compassBtn"),
    status: document.getElementById("status"),
    view: document.getElementById("mapView"),
    aerial: document.getElementById("aerial"),
    stage: document.getElementById("mapStage"),
    places: document.getElementById("places"),
    dots: document.getElementById("dots"),
    friends: document.getElementById("friends"),
    modalBg: document.getElementById("modalBg"),
    nameInput: document.getElementById("nameInput"),
    nameGo: document.getElementById("nameGo"),
    beacon: document.getElementById("beacon"),
    beaconName: document.getElementById("beaconName"),
    toast: document.getElementById("toast"),
  };

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  function store(key, val) {
    try { val === null ? localStorage.removeItem(key) : localStorage.setItem(key, val); } catch (e) {}
  }
  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  // ---- per-person look ----
  function hue(n) {
    let h = 0;
    for (const ch of n.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return h;
  }
  function color(n) { return `hsl(${hue(n)}, 85%, 48%)`; }
  function initials(n) {
    return n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  }
  function isMe(n) { return !!name && n.toLowerCase() === name.toLowerCase(); }

  function ago(ts) {
    const s = Math.max(0, Math.round((Date.now() + serverSkew - ts) / 1000));
    if (s < 45) return "just now";
    const m = Math.round(s / 60);
    return m === 1 ? "1 min ago" : `${m} min ago`;
  }

  // ---- name ----
  function withName(fn) {
    if (name) return fn();
    pendingAfterName = fn;
    els.modalBg.classList.add("show");
    els.nameInput.focus();
  }
  function setName(v) {
    v = (v || "").trim();
    if (!v) return;
    name = v;
    store(NAME_KEY, name);
    els.modalBg.classList.remove("show");
    const fn = pendingAfterName;
    pendingAfterName = null;
    if (fn) fn();
  }

  // ---- sending ----
  async function send(body) {
    const res = await fetch("/api/location", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, ...body }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "failed");
  }

  function sendFix() {
    if (!lastFix || lastFix.at <= lastSent) return;
    lastSent = lastFix.at;
    send({ lat: lastFix.lat, lon: lastFix.lon, accuracy: lastFix.accuracy })
      .then(poll)
      .catch(() => setStatus("Couldn't reach the server — will retry."));
  }

  function setStatus(msg) { els.status.textContent = msg; }

  function startSharing() {
    if (!("geolocation" in navigator)) {
      toast("Location isn't available here");
      return;
    }
    setStatus("Finding you…");
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const first = !lastFix;
        lastFix = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy),
          at: Date.now(),
        };
        setStatus(`Sharing as ${name} · ±${lastFix.accuracy} m`);
        if (first) sendFix();
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stopWatching();
          setStatus("Location permission is off. Use Drop pin instead.");
          toast("Location blocked");
        } else {
          setStatus("Can't get a GPS fix right now. Drop a pin instead?");
        }
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 }
    );
    sendTimer = setInterval(sendFix, SEND_MS);
  }

  function stopWatching() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    clearInterval(sendTimer);
    sendTimer = null;
  }


  // ---- 3D camera: tilt + rotation + zoom + pan, fed to CSS vars on the stage ----
  const TILT = 55; // degrees the ground plane leans back
  const ZOOM_STEP = 1.5;
  const MAX_ZOOM = 10;
  const HD_ZOOM = 2.5; // past this, swap in the sharper photo (downloaded once, on demand)
  let hdRequested = false;
  // Default view: turned 60° so T-Mobile is at the top and the lake runs down the right.
  // Phones start closer so signs are legible.
  const HOME = { rot: 60, x: 909, y: 577 }; // x/y = map pixel at the center of the view
  const zoomHome = () => (els.view.clientWidth < 500 ? 1.9 : 1.4);
  // zoom = stage width / view width; rot = degrees clockwise from north-up; x/y = pan in % of the stage
  const cam = { tilt: TILT, rot: 0, zoom: 1.25, x: 0, y: 0 };
  let savedRot = 0;

  function applyCam() {
    const s = els.stage.style;
    s.setProperty("--tilt", `${cam.tilt}deg`);
    s.setProperty("--rot", `${cam.rot}deg`);
    s.setProperty("--zoom", cam.zoom);
    s.setProperty("--pan-x", `${cam.x}%`);
    s.setProperty("--pan-y", `${cam.y}%`);
    if (cam.zoom > HD_ZOOM && !hdRequested) loadHd();
    // compass needle points to map north
    els.compassBtn.style.setProperty("--rot", `${cam.rot}deg`);
  }

  function loadHd() {
    hdRequested = true;
    const img = new Image();
    img.onload = () => { els.aerial.src = img.src; };
    img.src = "/festival-aerial-hd.jpg";
  }

  function clampCam() {
    cam.zoom = Math.min(MAX_ZOOM, Math.max(1, cam.zoom));
    cam.x = Math.min(50, Math.max(-50, cam.x));
    cam.y = Math.min(50, Math.max(-50, cam.y));
  }

  // Center the camera on a spot given in map pixels.
  function centerOn(mx, my) {
    cam.x = (0.5 - mx / G.MAP_W) * 100;
    cam.y = (0.5 - my / G.MAP_H) * 100;
    clampCam();
    applyCam();
  }

  function zoomBy(f) { cam.zoom *= f; clampCam(); applyCam(); }
  function rotateBy(deg) { cam.rot += deg; applyCam(); }
  // back to north-up the short way round
  function resetNorth() { cam.rot = Math.round(cam.rot / 360) * 360; applyCam(); }

  // Drag to pan; two fingers pinch to zoom and twist to rotate; Shift-drag rotates with a mouse.
  const pointers = new Map();
  let gesture = null;
  let lastDragEnd = 0; // a click right after a drag isn't a tap

  function startGesture() {
    const pts = [...pointers.values()];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const two = pts.length > 1;
    gesture = {
      cx, cy, x: cam.x, y: cam.y, zoom: cam.zoom, rot: cam.rot, moved: false,
      anchor: groundUnder(cx, cy),
      multi: two || (gesture ? gesture.multi : false), // any second finger disqualifies a tap
      dist: two ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
      angle: two ? Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x) : 0,
    };
  }

  function onPointerDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    els.view.setPointerCapture(e.pointerId);
    els.stage.classList.add("dragging");
    startGesture();
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.values()];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dx = cx - gesture.cx;
    const dy = cy - gesture.cy;
    if (Math.hypot(dx, dy) > 6) gesture.moved = true;

    if (pts.length > 1 && gesture.dist && !pinKind) {
      cam.zoom = gesture.zoom * (Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / gesture.dist);
      const angle = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
      const turn = Math.atan2(Math.sin(angle - gesture.angle), Math.cos(angle - gesture.angle)); // wrap to ±180°
      cam.rot = gesture.rot + (turn * 180) / Math.PI;
      gesture.moved = true;
    } else if (e.shiftKey && pts.length === 1 && !pinKind) {
      cam.rot = gesture.rot + dx * 0.4;
      clampCam();
      applyCam();
      return;
    }

    pinTo(gesture.anchor, cx, cy);
  }

  // Exact screen position of a map point (% of the stage), measured through the
  // real 3D transform with an invisible probe on the stage.
  let probe = null;
  function project(pt) {
    if (!probe) {
      probe = document.createElement("div");
      probe.style.cssText = "position:absolute;width:0;height:0;pointer-events:none";
      els.stage.appendChild(probe);
    }
    probe.style.left = `${pt.x}%`;
    probe.style.top = `${pt.y}%`;
    const r = probe.getBoundingClientRect();
    return { x: r.left, y: r.top };
  }

  // Measure without the CSS transition getting in the way.
  function instant(fn) {
    const had = els.stage.classList.contains("dragging");
    els.stage.classList.add("dragging");
    const out = fn();
    if (!had) els.stage.classList.remove("dragging");
    return out;
  }

  // How the screen position of map point `pt` changes per 1% of stage movement
  // (same for moving the point or panning the camera). Measured, so it includes
  // perspective — the far side of the tilted map moves much faster on screen.
  function jacobian(pt) {
    const o = project(pt);
    const ex = project({ x: pt.x + 1, y: pt.y });
    const ey = project({ x: pt.x, y: pt.y + 1 });
    return { o, a: ex.x - o.x, b: ey.x - o.x, c: ex.y - o.y, d: ey.y - o.y };
  }

  // One Newton step: the (x, y) % change that moves `pt` from its screen spot onto (sx, sy).
  function newtonStep(pt, sx, sy) {
    const J = jacobian(pt);
    const det = J.a * J.d - J.b * J.c;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return null;
    const ex = sx - J.o.x, ey = sy - J.o.y;
    return { x: (J.d * ex - J.b * ey) / det, y: (-J.c * ex + J.a * ey) / det, err: Math.hypot(ex, ey) };
  }

  // Map point (in % of the stage, from its top-left) under a screen point.
  function groundUnder(sx, sy) {
    return instant(() => {
      const v = els.view.getBoundingClientRect();
      const g = screenToGround(sx - (v.left + v.width / 2), sy - (v.top + v.height / 2));
      const pt = { x: 50 - cam.x + g.x, y: 50 - cam.y + g.y }; // flat first guess
      for (let i = 0; i < 6; i++) {
        const st = newtonStep(pt, sx, sy);
        if (!st || st.err < 0.5) break;
        pt.x += st.x;
        pt.y += st.y;
      }
      return pt;
    });
  }

  // Pan so a map point sits under a screen point (after zoom/rotation changed) —
  // drag, pinch and twist all pivot around your fingers, like Google Maps.
  function pinTo(anchor, sx, sy) {
    instant(() => {
      applyCam();
      for (let i = 0; i < 6; i++) {
        const st = newtonStep(anchor, sx, sy);
        if (!st || st.err < 0.5) break;
        cam.x += st.x;
        cam.y += st.y;
        clampCam();
        applyCam();
      }
    });
  }

  // Safari's own pinch/rotate events: the only way to read a Mac trackpad twist,
  // and blocking them stops iPhone Safari from zooming the whole page instead.
  let trackpad = null;
  function onGestureStart(e) {
    e.preventDefault();
    if (pointers.size || pinKind) return; // touchscreens are handled by pointer events
    trackpad = { zoom: cam.zoom, rot: cam.rot, anchor: groundUnder(e.clientX, e.clientY) };
    els.stage.classList.add("dragging");
  }
  function onGestureChange(e) {
    e.preventDefault();
    if (!trackpad) return;
    cam.zoom = trackpad.zoom * e.scale;
    cam.rot = trackpad.rot + e.rotation;
    clampCam();
    pinTo(trackpad.anchor, e.clientX, e.clientY);
  }
  function onGestureEnd(e) {
    e.preventDefault();
    trackpad = null;
    els.stage.classList.remove("dragging");
  }

  // Screen offset (px) -> ground offset (% of the stage): undo the tilt's
  // foreshortening, then the rotation. Ignores perspective, fine near the middle.
  function screenToGround(dx, dy) {
    const t = (cam.tilt * Math.PI) / 180;
    const r = (cam.rot * Math.PI) / 180;
    const gy = dy / Math.max(0.3, Math.cos(t));
    const px = dx * Math.cos(r) + gy * Math.sin(r);
    const py = -dx * Math.sin(r) + gy * Math.cos(r);
    const stageW = els.view.clientWidth * cam.zoom;
    const stageH = stageW * (G.MAP_H / G.MAP_W);
    return { x: (px / stageW) * 100, y: (py / stageH) * 100 };
  }

  // Double tap / double click: bring that spot to the middle and zoom in 2x.
  let lastTap = null;
  function onTap(x, y) {
    const now = Date.now();
    if (lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
      lastTap = null;
      if (!pinKind) zoomAt(x, y);
      return;
    }
    lastTap = { t: now, x, y };
  }

  function zoomAt(sx, sy) {
    const v = els.view.getBoundingClientRect();
    const g = screenToGround(sx - (v.left + v.width / 2), sy - (v.top + v.height / 2));
    cam.x -= g.x;
    cam.y -= g.y;
    cam.zoom *= 2;
    clampCam();
    applyCam();
  }

  function onPointerUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (gesture && gesture.moved) lastDragEnd = Date.now();
    else if (gesture && !gesture.multi && !pointers.size) onTap(e.clientX, e.clientY);
    if (pointers.size) startGesture();
    else {
      gesture = null;
      els.stage.classList.remove("dragging");
    }
  }

  function onWheel(e) {
    if (!e.ctrlKey) return; // trackpad pinch; plain scrolling still scrolls the page
    e.preventDefault();
    const anchor = groundUnder(e.clientX, e.clientY);
    cam.zoom *= Math.exp(-e.deltaY * 0.01);
    clampCam();
    pinTo(anchor, e.clientX, e.clientY); // zoom toward the cursor
  }

  // ---- pin drop / meeting point ----
  // The map lies flat and north-up while placing so a tap maps straight to a ground spot.
  function setPinMode(kind) {
    const wasOn = !!pinKind;
    pinKind = kind;
    const on = !!kind;
    els.view.classList.toggle("pinning", on);
    els.view.dataset.hint = kind === "meet" ? "Tap the meeting spot" : "Tap where you are";
    els.pinBtn.textContent = kind === "me" ? "Cancel pin" : "Drop pin";
    els.meetBtn.textContent = kind === "meet" ? "Cancel" : "Set meeting point";
    if (on && !wasOn) {
      savedRot = cam.rot;
      cam.rot = Math.round(cam.rot / 360) * 360;
    } else if (!on && wasOn) {
      cam.rot = savedRot;
    }
    cam.tilt = on ? 0 : TILT;
    applyCam();
    if (kind === "me") setStatus("Tap the map where you are.");
    if (kind === "meet") setStatus("Tap where everyone should meet.");
  }

  function onMapTap(e) {
    if (Date.now() - lastDragEnd < 250) return;
    if (!pinKind) return;
    const r = els.stage.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * G.MAP_W);
    const y = Math.round(((e.clientY - r.top) / r.height) * G.MAP_H);
    const body = { x, y };
    if (pinKind === "meet") {
      setPinMode(null);
      fetch("/api/meetup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, x, y }),
      })
        .then((res) => {
          if (!res.ok) throw new Error();
          toast("Meeting point set");
          setStatus("Everyone can see the meeting point now.");
          poll();
        })
        .catch(() => toast("Couldn't set meeting point"));
      return;
    }
    // A pin replaces live GPS until the app is next opened.
    const wasSharing = watchId !== null;
    stopWatching();
    setPinMode(null);
    send(body)
      .then(() => {
        toast(wasSharing ? "Pinned · live sharing paused" : "Pinned");
        setStatus(`Pinned as ${name}. Live GPS resumes next time you open the map.`);
        poll();
      })
      .catch(() => toast("Couldn't save pin"));
  }

  // ---- friends ----
  async function poll() {
    try {
      const data = await fetch("/api/locations").then((r) => r.json());
      serverSkew = data.now - Date.now();
      people = data.people;
      meetup = data.meetup;
      render();
    } catch (e) {}
  }

  // -> { x, y, r, pinned } in map pixels, or null if not placeable
  function place(p) {
    if (p.x !== null && p.y !== null) return { x: p.x, y: p.y, r: 30, pinned: true };
    if (p.lat === null || p.lon === null) return null;
    const c = G.toPixel(p.lat, p.lon);
    // halo = GPS accuracy radius, drawn to scale
    const r = Math.min(300, Math.max(30, (p.accuracy || 10) / G.M_PER_PX));
    return { x: c.x, y: c.y, r, pinned: false };
  }

  function render() {
    els.dots.innerHTML = "";
    els.friends.innerHTML = "";
    const pct = (v, of) => `${(v / of) * 100}%`;
    renderMeetup(pct);

    const rows = people.map((p) => ({ p, at: place(p) }));
    rows.sort((a, b) => (isMe(b.p.name) - isMe(a.p.name)) || a.p.name.localeCompare(b.p.name));

    for (const { p, at } of rows) {
      const onMap = at && at.x >= 0 && at.x <= G.MAP_W && at.y >= 0 && at.y <= G.MAP_H;
      const near = at && G.nearestPlace(at.x, at.y);
      const where = !onMap || !near ? "not at the festival" : `near ${near.name}`;
      const col = color(p.name);

      if (onMap) {
        const halo = document.createElement("div");
        halo.className = "dot-halo";
        halo.style.left = pct(at.x, G.MAP_W);
        halo.style.top = pct(at.y, G.MAP_H);
        halo.style.width = halo.style.height = pct(at.r * 2, G.MAP_W);
        halo.style.background = col;
        els.dots.appendChild(halo);

        // Upright marker standing on the ground: name tag, badge, then a pole.
        const dot = document.createElement("div");
        dot.className = "dot" + (at.pinned ? " pinned" : "") + (isMe(p.name) ? " me" : "");
        dot.style.left = pct(at.x, G.MAP_W);
        dot.style.top = pct(at.y, G.MAP_H);
        dot.dataset.name = p.name;
        dot.dataset.x = at.x;
        dot.dataset.y = at.y;
        dot.innerHTML = `<span class="dot-label"></span><span class="badge"><span class="ini"></span></span><span class="pole"></span>`;
        dot.querySelector(".badge").style.background = col;
        dot.querySelector(".ini").textContent = initials(p.name);
        dot.querySelector(".dot-label").textContent = isMe(p.name) ? "You" : p.name;
        els.dots.appendChild(dot);
      }

      const row = document.createElement("button");
      row.className = "friend";
      row.innerHTML = `<span class="sw"></span><span class="fn"></span><span class="fw"></span>`;
      row.querySelector(".sw").style.background = col;
      row.querySelector(".fn").textContent = isMe(p.name) ? `${p.name} (you)` : p.name;
      row.querySelector(".fw").textContent = `${where}${at && at.pinned ? " · pin" : ""} · ${ago(p.updatedAt)}`;
      if (onMap) row.addEventListener("click", () => focusDot(p.name));
      els.friends.appendChild(row);
    }

    if (!rows.length) {
      els.friends.innerHTML = `<div class="friends-empty">No one's sharing yet.</div>`;
    }
  }

  // Big shared "meet here" flag on the map + a card above the friends list.
  function renderMeetup(pct) {
    els.meetCard.innerHTML = "";
    els.meetCard.hidden = !meetup;
    if (!meetup) return;
    const near = G.nearestPlace(meetup.x, meetup.y);

    const ring = document.createElement("div");
    ring.className = "meet-ring";
    ring.style.left = pct(meetup.x, G.MAP_W);
    ring.style.top = pct(meetup.y, G.MAP_H);
    els.dots.appendChild(ring);

    const flag = document.createElement("div");
    flag.className = "dot meet";
    flag.style.left = pct(meetup.x, G.MAP_W);
    flag.style.top = pct(meetup.y, G.MAP_H);
    flag.innerHTML = `<span class="meet-sign">Meet here</span><span class="pole"></span>`;
    els.dots.appendChild(flag);

    els.meetCard.innerHTML =
      `<span class="mc-flag"></span><span class="mc-text"><b>Meeting point</b><span class="mc-sub"></span></span>` +
      `<button class="btn mc-show">Show</button><button class="btn ghost mc-remove">Remove</button>`;
    els.meetCard.querySelector(".mc-sub").textContent =
      `${near ? `near ${near.name}` : "on the map"} · set by ${isMe(meetup.setBy) ? "you" : meetup.setBy} · ${ago(meetup.updatedAt)}`;
    els.meetCard.querySelector(".mc-show").addEventListener("click", () => {
      cam.zoom = Math.max(cam.zoom, 2);
      centerOn(meetup.x, meetup.y);
      els.view.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    els.meetCard.querySelector(".mc-remove").addEventListener("click", () => {
      fetch("/api/meetup", { method: "DELETE" })
        .then(() => { toast("Meeting point removed"); poll(); })
        .catch(() => toast("Couldn't remove it"));
    });
  }

  function focusDot(n) {
    const dot = [...els.dots.querySelectorAll(".dot")].find((d) => d.dataset.name === n);
    if (!dot) return;
    cam.zoom = Math.max(cam.zoom, 2);
    centerOn(+dot.dataset.x, +dot.dataset.y);
    els.view.scrollIntoView({ behavior: "smooth", block: "center" });
    dot.classList.remove("pulse");
    void dot.offsetWidth;
    dot.classList.add("pulse");
  }

  // ---- beacon ----
  let wakeLock = null;
  function openBeacon() {
    els.beacon.style.setProperty("--beacon", color(name));
    els.beaconName.textContent = name;
    els.beacon.classList.add("show");
    if (navigator.wakeLock) navigator.wakeLock.request("screen").then((l) => (wakeLock = l)).catch(() => {});
  }
  function closeBeacon() {
    els.beacon.classList.remove("show");
    if (wakeLock) wakeLock.release().catch(() => {});
    wakeLock = null;
  }

  // Stage / area / gate labels, positioned in % so they track the map at any zoom.
  function renderPlaces() {
    for (const p of G.PLACES) {
      const el = document.createElement("div");
      el.className = `place ${p.kind}`;
      el.style.left = `${(p.x / G.MAP_W) * 100}%`;
      el.style.top = `${(p.y / G.MAP_H) * 100}%`;
      el.innerHTML = `<span class="sign"></span><span class="pole"></span>`;
      el.querySelector(".sign").textContent = p.name;
      els.places.appendChild(el);
    }
  }

  function init() {
    name = load(NAME_KEY);

    els.nameGo.addEventListener("click", () => setName(els.nameInput.value));
    els.nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") setName(els.nameInput.value); });
    els.modalBg.addEventListener("click", (e) => {
      if (e.target === els.modalBg) { els.modalBg.classList.remove("show"); pendingAfterName = null; }
    });

    els.pinBtn.addEventListener("click", () => withName(() => setPinMode(pinKind === "me" ? null : "me")));
    els.meetBtn.addEventListener("click", () => withName(() => setPinMode(pinKind === "meet" ? null : "meet")));
    els.view.addEventListener("click", onMapTap);
    els.view.addEventListener("pointerdown", onPointerDown);
    els.view.addEventListener("pointermove", onPointerMove);
    els.view.addEventListener("pointerup", onPointerUp);
    els.view.addEventListener("pointercancel", onPointerUp);
    els.view.addEventListener("wheel", onWheel, { passive: false });
    els.view.addEventListener("gesturestart", onGestureStart, { passive: false });
    els.view.addEventListener("gesturechange", onGestureChange, { passive: false });
    els.view.addEventListener("gestureend", onGestureEnd, { passive: false });
    // belt and braces for iOS: never let a two-finger touch on the map scroll/zoom the page
    els.view.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    els.beaconBtn.addEventListener("click", () => withName(openBeacon));
    els.beacon.addEventListener("click", closeBeacon);
    els.zoomInBtn.addEventListener("click", () => zoomBy(ZOOM_STEP));
    els.zoomOutBtn.addEventListener("click", () => zoomBy(1 / ZOOM_STEP));
    els.rotLeftBtn.addEventListener("click", () => rotateBy(-30));
    els.rotRightBtn.addEventListener("click", () => rotateBy(30));
    els.compassBtn.addEventListener("click", resetNorth);
    // keep control taps from starting a map drag
    els.controls.addEventListener("pointerdown", (e) => e.stopPropagation());
    els.controls.addEventListener("click", (e) => e.stopPropagation());

    cam.zoom = zoomHome();
    cam.rot = HOME.rot;
    centerOn(HOME.x, HOME.y);
    renderPlaces();
    // Always share while the map is open; ask for a name first if we don't have one.
    withName(startSharing);
    poll();
    setInterval(poll, POLL_MS);
  }

  init();
})();
