// Weekend page: one chronological timeline per day mixing the ACL sets the group
// picked with shared plans (pregames, brunches, night shows) anyone can add/edit.
(function () {
  const POLL_MS = 5000;
  const LATE_NIGHT_MIN = 5 * 60; // times before 5 AM sort after the evening (same "day")
  const escapeHtml = ACLGrid.escapeHtml;
  const PLAN_DEFAULT_MIN = 60;  // assumed length of a plan with no end time
  const GAP_MIN_SHOWN = 15;     // free time shorter than this isn't drawn
  const GAP_PX_PER_MIN = 0.6;   // 1 hr of free time = 36px of space
  const KIND_LABELS ={ event: "Event", hangout: "Pregame / Other" };

  let scheduleData = null;
  let events = [];
  let results = { voters: {} };
  let activeDay = null;
  let editing = null; // event being edited, or null when adding
  let formDay = null;
  let formKind = "event";

  const els = {
    days: document.getElementById("days"),
    timeline: document.getElementById("timeline"),
    addBtn: document.getElementById("addBtn"),
    modalBg: document.getElementById("modalBg"),
    form: document.getElementById("eventForm"),
    formTitle: document.getElementById("formTitle"),
    formDays: document.getElementById("formDays"),
    formKinds: document.getElementById("formKinds"),
    cancelBtn: document.getElementById("cancelBtn"),
    saveBtn: document.getElementById("saveBtn"),
    deleteBtn: document.getElementById("deleteBtn"),
    toast: document.getElementById("toast"),
  };

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove("show"), 1900);
  }

  // ---- time helpers (minutes since midnight) ----
  function hhmmToMin(t) {
    const [h, m] = t.split(":").map(Number);
    return h * 60 + m;
  }
  function fmtMin(min) {
    const h24 = Math.floor(min / 60) % 24;
    const m = min % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
  }
  // Big calendar-style start time for the left column: "10:00" over a small "AM".
  function timeBlock(min) {
    const [hm, ap] = fmtMin(min).split(" ");
    return `<span class="tl-hm">${hm}</span><span class="tl-ap">${ap}</span>`;
  }
  const sortKey =(min) => (min < LATE_NIGHT_MIN ? min + 1440 : min);
  // ACL grid rows are 15-min slots counted from noon (row 1 = 12:00 PM).
  const rowToMin = (row) => 12 * 60 + (row - 1) * scheduleData.slotMin;

  // Turn bare URLs in user text into links (text is escaped first).
  function linkify(text) {
    return escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
  }
  const mapsUrl = (q) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q + ", Austin, TX");

  function stageName(key) {
    const s = scheduleData.stages.find((x) => x.key === key);
    return key === "titos" ? "Tito's" : s ? s.label : key;
  }

  // ---- timeline items for one day ----
  function itemsFor(dayKey) {
    const items = [];
    for (const a of scheduleData.artists) {
      if (a.day !== dayKey) continue;
      const v = results.voters[a.id];
      if (!v || v.definitely.length + v.maybe.length === 0) continue;
      const start = rowToMin(a.rowStart);
      // span: minutes the item occupies (headliners use the grid's default set length)
      const span = rowToMin(a.rowEnd) - start;
      items.push({ kind: "acl", start, end: a.end ? rowToMin(a.rowEnd) : null, span, artist: a, voters: v });
    }
    for (const ev of events) {
      if (ev.day !== dayKey) continue;
      const start = hhmmToMin(ev.start);
      const end = ev.end ? hhmmToMin(ev.end) : null;
      const span = end != null ? (end - start + 1440) % 1440 : PLAN_DEFAULT_MIN; // end may be past midnight
      items.push({ kind: "plan", start, end, span, ev });
    }
    items.sort((x, y) => sortKey(x.start) - sortKey(y.start) || (x.kind === y.kind ? 0 : x.kind === "plan" ? -1 : 1));
    return items;
  }

  function timeRange(it) {
    return it.end != null ? `${fmtMin(it.start)} – ${fmtMin(it.end)}` : fmtMin(it.start);
  }

  function aclCard(it) {
    const { artist, voters } = it;
    let who = "";
    if (voters.definitely.length) who += `<div class="who"><span class="lab def">Definitely</span>${escapeHtml(voters.definitely.join(", "))}</div>`;
    if (voters.maybe.length) who += `<div class="who"><span class="lab maybe">Maybe</span>${escapeHtml(voters.maybe.join(", "))}</div>`;
    return `
      <div class="card acl">
        <div class="card-kicker">ACL &middot; ${escapeHtml(stageName(artist.stage))}</div>
        <div class="card-name">${escapeHtml(artist.name)}</div>
        <div class="card-time">${timeRange(it)}</div>
        ${who}
      </div>`;
  }

  function planCard(it) {
    const { ev } = it;
    return `
      <div class="card plan">
        <button class="card-edit" type="button" data-id="${ev.id}">Edit</button>
        <div class="card-kicker">${KIND_LABELS[ev.kind] || KIND_LABELS.event}</div>
        <div class="card-name">${escapeHtml(ev.name)}</div>
        <div class="card-time">${timeRange(it)}</div>
        ${ev.location ? `<div class="card-loc">📍 <a href="${mapsUrl(ev.location)}" target="_blank" rel="noopener">${escapeHtml(ev.location)}</a></div>` : ""}
        ${ev.description ? `<div class="card-desc">${linkify(ev.description)}</div>` : ""}
      </div>`;
  }

  function render() {
    if (!scheduleData) return;
    const items = itemsFor(activeDay);
    if (!items.length) {
      els.timeline.innerHTML = `<div class="tl-empty">Nothing on the books yet. Tap <b>+</b> to add a plan.</div>`;
      return;
    }
    // Free time between the end of everything so far and the next start becomes a
    // spacer whose height is proportional to its length.
    let busyUntil = null;
    const gapBefore = (it) => {
      const s = sortKey(it.start);
      const gap = busyUntil == null ? 0 : s - busyUntil;
      busyUntil = Math.max(busyUntil == null ? s : busyUntil, s + it.span);
      if (gap < GAP_MIN_SHOWN) return "";
      const h = Math.floor(gap / 60), m = gap % 60;
      const label = [h && `${h} hr`, m && `${m} min`].filter(Boolean).join(" ");
      return `<li class="tl-gap" style="height:${Math.round(gap * GAP_PX_PER_MIN)}px"><span>${label} free</span></li>`;
    };
    els.timeline.innerHTML = `<ol class="tl">${items
      .map((it) => `${gapBefore(it)}
        <li class="tl-item ${it.kind}${it.ev ? " " + (it.ev.kind || "event") : ""}">
          <div class="tl-time">${timeBlock(it.start)}</div>
          <div class="tl-dot"></div>
          ${it.kind === "acl" ? aclCard(it) : planCard(it)}
        </li>`)
      .join("")}</ol>`;
  }

  async function refresh() {
    try {
      const [ev, res] = await Promise.all([
        fetch("/api/events").then((r) => r.json()),
        fetch("/api/results").then((r) => r.json()),
      ]);
      events = ev.events || [];
      results = res;
      render();
    } catch (e) { /* keep last render on transient error */ }
  }

  // ---- add / edit modal ----
  function setFormDay(key) {
    formDay = key;
    els.formDays.querySelectorAll(".day-tab").forEach((b) => b.classList.toggle("active", b.dataset.day === key));
  }

  function setFormKind(kind) {
    formKind = kind in KIND_LABELS ? kind : "event";
    els.formKinds.querySelectorAll(".day-tab").forEach((b) => b.classList.toggle("active", b.dataset.kind === formKind));
  }

  function openForm(ev) {
    editing = ev || null;
    const f = els.form.elements;
    els.formTitle.textContent = ev ? "Edit plan" : "Add a plan";
    f.name.value = ev ? ev.name : "";
    f.start.value = ev ? ev.start : "";
    f.end.value = ev && ev.end ? ev.end : "";
    f.location.value = ev ? ev.location : "";
    f.description.value = ev ? ev.description : "";
    setFormDay(ev ? ev.day : activeDay);
    setFormKind(ev ? ev.kind : "event");
    els.deleteBtn.hidden = !ev;
    resetDelete();
    els.modalBg.classList.add("show");
    if (!ev) f.name.focus();
  }
  function closeForm() { els.modalBg.classList.remove("show"); editing = null; }

  // Two-tap delete so a stray tap can't wipe a plan.
  function resetDelete() { els.deleteBtn.classList.remove("armed"); els.deleteBtn.textContent = "Delete this plan"; }

  async function save(e) {
    e.preventDefault();
    const f = els.form.elements;
    const body = {
      day: formDay,
      start: f.start.value,
      end: f.end.value || null,
      name: f.name.value,
      description: f.description.value,
      location: f.location.value,
      kind: formKind,
    };
    els.saveBtn.disabled = true;
    try {
      const res = await fetch(editing ? `/api/events/${editing.id}` : "/api/events", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      const wasEditing = !!editing;
      closeForm();
      if (body.day !== activeDay) selectDay(body.day);
      await refresh();
      toast(wasEditing ? "Plan updated" : "Plan added 🎉");
    } catch (err) {
      toast("Error: " + err.message);
    } finally {
      els.saveBtn.disabled = false;
    }
  }

  async function del() {
    if (!editing) return;
    if (!els.deleteBtn.classList.contains("armed")) {
      els.deleteBtn.classList.add("armed");
      els.deleteBtn.textContent = "Tap again to delete";
      return;
    }
    try {
      const res = await fetch(`/api/events/${editing.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "delete failed");
      closeForm();
      await refresh();
      toast("Plan deleted");
    } catch (err) {
      toast("Error: " + err.message);
    }
  }

  // Keep the page's day tabs in sync when switching days programmatically.
  function selectDay(key) {
    activeDay = key;
    els.days.querySelectorAll(".day-tab").forEach((b, i) => b.classList.toggle("active", scheduleData.days[i].key === key));
    render();
  }

  async function init() {
    scheduleData = await fetch("/api/schedule").then((r) => r.json());
    activeDay = scheduleData.days[0].key;
    ACLGrid.buildDayTabs(els.days, scheduleData.days, (key) => { activeDay = key; render(); });

    scheduleData.days.forEach((d) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "day-tab";
      b.dataset.day = d.key;
      b.textContent = d.label.slice(0, 3);
      b.addEventListener("click", () => setFormDay(d.key));
      els.formDays.appendChild(b);
    });

    els.addBtn.addEventListener("click", () => openForm(null));
    els.cancelBtn.addEventListener("click", closeForm);
    els.modalBg.addEventListener("click", (e) => { if (e.target === els.modalBg) closeForm(); });
    els.form.addEventListener("submit", save);
    els.deleteBtn.addEventListener("click", del);
    els.formKinds.querySelectorAll(".day-tab").forEach((b) => b.addEventListener("click", () => setFormKind(b.dataset.kind)));
    // Only a plan's Edit button opens the editor.
    els.timeline.addEventListener("click", (e) => {
      const btn = e.target.closest(".card-edit");
      if (!btn) return;
      const ev = events.find((x) => String(x.id) === btn.dataset.id);
      if (ev) openForm(ev);
    });

    await refresh();
    setInterval(() => { if (!els.modalBg.classList.contains("show")) refresh(); }, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }

  init();
})();
