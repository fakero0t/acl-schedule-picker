// Picker page: choose artists at two tiers (Definitely / Maybe), submit, edit.
(function () {
  const NAME_KEY = "acl_name";
  const DRAFT_PREFIX = "acl_draft_v1_";
  let name = null;
  let selected = new Map(); // id -> "definitely" | "maybe"
  let locked = false;       // true after a successful submit (read-only until Edit)
  let gridApi = null;

  const els = {
    days: document.getElementById("days"),
    grid: document.getElementById("grid"),
    submitBtn: document.getElementById("submitBtn"),
    editBtn: document.getElementById("editBtn"),
    hint: document.getElementById("hint"),
    toast: document.getElementById("toast"),
    modalBg: document.getElementById("modalBg"),
    nameInput: document.getElementById("nameInput"),
    nameGo: document.getElementById("nameGo"),
    duelBg: document.getElementById("duelBg"),
    duelProgress: document.getElementById("duelProgress"),
    duelQ: document.getElementById("duelQ"),
    duelOptions: document.getElementById("duelOptions"),
    duelBack: document.getElementById("duelBack"),
    duelNext: document.getElementById("duelNext"),
    duelSubmit: document.getElementById("duelSubmit"),
  };

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove("show"), 1900);
  }

  function haptic() {
    if (navigator.vibrate) { try { navigator.vibrate(10); } catch (e) {} }
  }

  // ---- draft persistence (survive a refresh before submitting) ----
  function draftKey() { return DRAFT_PREFIX + (name || "").toLowerCase(); }
  function saveDraft() {
    if (!name) return;
    try {
      const picks = [...selected.entries()].map(([id, tier]) => ({ id, tier }));
      localStorage.setItem(draftKey(), JSON.stringify(picks));
    } catch (e) {}
  }
  function loadDraft() {
    try {
      const raw = localStorage.getItem(draftKey());
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearDraft() { try { localStorage.removeItem(draftKey()); } catch (e) {} }

  function counts() {
    let def = 0, maybe = 0;
    for (const t of selected.values()) (t === "maybe" ? (maybe++) : (def++));
    return { def, maybe, total: selected.size };
  }

  function applyLockUI() {
    els.grid.querySelectorAll(".grid").forEach((g) => g.classList.toggle("locked", locked));
    els.submitBtn.hidden = locked;
    els.editBtn.hidden = !locked;
    const c = counts();
    els.hint.innerHTML = locked
      ? `Submitted <b>${c.def}</b> definitely &middot; <b>${c.maybe}</b> maybe. Hit <b>Edit</b> to change.`
      : `Tap an artist, then pick <b>Definitely</b> or <b>Maybe</b>. Hit <b>Submit</b> when set.`;
  }

  // Reflect the current tier state onto one box.
  function updateBox(box) {
    const id = box.dataset.id;
    const tier = selected.get(id) || null;
    box.classList.toggle("selected", !!tier);
    box.classList.toggle("t-def", tier === "definitely");
    box.classList.toggle("t-maybe", tier === "maybe");
    box.querySelector(".pill.def").classList.toggle("active", tier === "definitely");
    box.querySelector(".pill.maybe").classList.toggle("active", tier === "maybe");
    box.querySelector(".tier-tag").textContent = tier === "maybe" ? "MAYBE" : tier ? "DEFINITELY" : "";
  }

  function setTier(box, tier) {
    if (locked) return;
    selected.set(box.dataset.id, tier);
    updateBox(box);
    saveDraft();
    haptic();
  }

  function remove(box) {
    if (locked) return;
    selected.delete(box.dataset.id);
    updateBox(box);
    saveDraft();
    haptic();
  }

  function decorateBox(box) {
    // remove (✕) badge
    const badge = document.createElement("button");
    badge.className = "badge";
    badge.type = "button";
    badge.textContent = "✕";
    badge.setAttribute("aria-label", "Remove");
    box.appendChild(badge);

    // inline Def / Maybe toggle
    const pills = document.createElement("div");
    pills.className = "pills";
    const def = document.createElement("button");
    def.className = "pill def"; def.type = "button"; def.textContent = "Definitely";
    const maybe = document.createElement("button");
    maybe.className = "pill maybe"; maybe.type = "button"; maybe.textContent = "Maybe";
    pills.append(def, maybe);
    box.appendChild(pills);

    // static tier label shown when locked
    const tag = document.createElement("span");
    tag.className = "tier-tag";
    box.appendChild(tag);

    // body tap: select as Definitely when empty (does nothing when already selected)
    box.addEventListener("click", () => {
      if (locked) return;
      if (!selected.has(box.dataset.id)) setTier(box, "definitely");
    });
    def.addEventListener("click", (e) => { e.stopPropagation(); setTier(box, "definitely"); });
    maybe.addEventListener("click", (e) => { e.stopPropagation(); setTier(box, "maybe"); });
    badge.addEventListener("click", (e) => { e.stopPropagation(); remove(box); });
  }

  function repaint() {
    els.grid.querySelectorAll(".box").forEach(updateBox);
  }

  async function submit() {
    if (!name) { openModal(); return; }
    els.submitBtn.disabled = true;
    try {
      const picks = [...selected.entries()].map(([id, tier]) => ({ id, tier }));
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, picks }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "submit failed");
      locked = true;
      clearDraft(); // now saved server-side
      applyLockUI();
      toast("Submitted! 🎉");
    } catch (e) {
      toast("Error: " + e.message);
    } finally {
      els.submitBtn.disabled = false;
    }
  }

  function edit() { locked = false; applyLockUI(); toast("Edit mode"); }

  function openModal() { els.modalBg.classList.add("show"); els.nameInput.focus(); }
  function closeModal() { els.modalBg.classList.remove("show"); }

  async function setName(n) {
    name = (n || "").trim();
    if (!name) return;
    localStorage.setItem(NAME_KEY, name);
    closeModal();
    try {
      const draft = loadDraft();
      const me = await fetch("/api/me?name=" + encodeURIComponent(name)).then((r) => r.json());
      if (draft && draft.length) {
        // Unsubmitted in-progress work wins (survives a refresh, stays editable).
        selected = new Map(draft.map((p) => [p.id, p.tier || "definitely"]));
        locked = false;
        repaint();
      } else if (me.picks && me.picks.length) {
        selected = new Map(me.picks.map((p) => [p.id, p.tier || "definitely"]));
        locked = true; // they already submitted before
        repaint();
      }
    } catch (e) {}
    applyLockUI();
    toast("Hi, " + name + "!");
  }

  // ---- duel quiz ----
  let duel = { clashes: [], answers: {}, i: 0, done: false };

  function renderDuel() {
    const clash = duel.clashes[duel.i];
    if (!clash) return;
    const esc = ACLGrid.escapeHtml;
    els.duelProgress.textContent = `${duel.i + 1} / ${duel.clashes.length}`;

    const opts = clash.options; // sorted by rowStart
    const startOf = (t) => String(t).split("–")[0].trim();
    const endOf = (t) => { const p = String(t).split("–"); return (p[1] || p[0]).trim(); };
    const latest = opts.reduce((m, o) => (o.rowEnd > m.rowEnd ? o : m), opts[0]);
    els.duelQ.innerHTML =
      `<span class="dq-bolt">⚡</span> CONFLICT · ${esc(startOf(opts[0].timeLabel))}–${esc(endOf(latest.timeLabel))}`;

    const chosen = duel.answers[clash.id];
    const cc = (i) => "c" + (i % 4);
    const tierLine = (lab, names) =>
      `<div class="vc-tier"><span class="vt-lab ${lab.toLowerCase()}">${lab}</span> ${names.length ? esc(names.join(", ")) : "—"}</div>`;

    // matchup cards, tilted and spilling, with a lightning bolt between each
    const BOLT = '<svg class="bolt" viewBox="0 0 40 100" aria-hidden="true"><path d="M25 2 4 58 18 58 12 98 38 40 22 40Z"/></svg>';
    const n = opts.length;
    let cards = "";
    opts.forEach((o, i) => {
      if (i > 0) cards += `<div class="vs-bolt">${BOLT}</div>`;
      const side = i % 2 === 0 ? "from-left" : "from-right";
      const tilt = n === 1 ? 0 : i === 0 ? -8 : i === n - 1 ? 8 : 0;
      const edge = n > 1 ? (i === 0 ? " edge-l" : i === n - 1 ? " edge-r" : "") : "";
      cards += `<div class="vs-card ${cc(i)} ${side}${edge}${chosen === o.id ? " sel" : ""}" data-choice="${o.id}" style="--tilt:${tilt}deg;animation-delay:${i * 80}ms">
          <div class="vc-name">${esc(o.name)}</div>
          <div class="vc-meta">${esc(o.timeLabel)} · ${esc(o.stage)}</div>
          ${tierLine("DEFINITELY", o.definitely || [])}
          ${tierLine("MAYBE", o.maybe || [])}
        </div>`;
    });

    // choose row: one color-linked button per artist, then split, then no preference
    let choose = opts.map((o, i) =>
      `<button class="choose ${cc(i)}${chosen === o.id ? " sel" : ""}" data-choice="${o.id}">${esc(o.name)}</button>`
    ).join("");
    choose += `<button class="choose split${chosen === "split" ? " sel" : ""}" data-choice="split">Keep both — split into groups</button>`;
    choose += `<button class="choose none${chosen === "none" ? " sel" : ""}" data-choice="none">No preference</button>`;

    els.duelOptions.innerHTML =
      `<div class="vs-row" data-n="${opts.length}"><div class="vs-flash"></div>${cards}</div>` +
      `<div class="choose-row">${choose}</div>`;

    els.duelOptions.querySelectorAll("[data-choice]").forEach((b) =>
      b.addEventListener("click", () => chooseDuel(clash.id, b.dataset.choice)));

    els.duelBack.disabled = duel.i === 0;
    const answeredAll = duel.clashes.every((c) => duel.answers[c.id] != null);
    const isLast = duel.i === duel.clashes.length - 1;
    els.duelNext.hidden = isLast;
    els.duelSubmit.hidden = !isLast;
    els.duelSubmit.disabled = !answeredAll;
  }

  async function chooseDuel(clashId, choice) {
    duel.answers[clashId] = choice;
    renderDuel();
    try {
      const res = await fetch("/api/duel/answer", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, clashId, choice }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch (e) {
      toast("Error saving your answer — try again");
    }
    if (duel.i < duel.clashes.length - 1) { duel.i++; renderDuel(); }
  }

  async function submitDuel() {
    els.duelSubmit.disabled = true;
    try {
      const res = await fetch("/api/duel/submit", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error("submit failed");
      els.duelBg.classList.remove("show");
      toast("Locked in! See the group plan.");
      setTimeout(() => (window.location.href = "/plan"), 900);
    } catch (e) {
      els.duelSubmit.disabled = false;
      toast("Error saving — try again");
    }
  }

  async function maybeOpenDuel() {
    if (!name) return;
    let data;
    try { data = await fetch("/api/duel?name=" + encodeURIComponent(name)).then((r) => r.json()); }
    catch (e) { return; }
    if (data.phase !== "duel" || data.done || !data.hasSubmission || !data.clashes.length) return;
    duel = { clashes: data.clashes, answers: data.myAnswers || {}, i: 0, done: false };
    // resume at first unanswered clash
    const firstUnanswered = duel.clashes.findIndex((c) => duel.answers[c.id] == null);
    duel.i = firstUnanswered === -1 ? 0 : firstUnanswered;
    renderDuel();
    els.duelBg.classList.add("show");
  }

  async function init() {
    const data = await fetch("/api/schedule").then((r) => r.json());
    ACLGrid.buildDayTabs(els.days, data.days, (dayKey) => gridApi.show(dayKey));
    gridApi = ACLGrid.render(els.grid, data, decorateBox);

    els.submitBtn.addEventListener("click", submit);
    els.editBtn.addEventListener("click", edit);
    els.duelBack.addEventListener("click", () => { if (duel.i > 0) { duel.i--; renderDuel(); } });
    els.duelNext.addEventListener("click", () => { if (duel.i < duel.clashes.length - 1) { duel.i++; renderDuel(); } });
    els.duelSubmit.addEventListener("click", submitDuel);
    els.nameGo.addEventListener("click", () => setName(els.nameInput.value));
    els.nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") setName(els.nameInput.value); });

    const saved = localStorage.getItem(NAME_KEY);
    if (saved) await setName(saved);
    else openModal();

    applyLockUI();

    try {
      const { phase } = await fetch("/api/phase").then((r) => r.json());
      if (phase === "duel") {
        locked = true;               // freeze the picker (reuse lock UI)
        applyLockUI();
        els.submitBtn.hidden = true;
        els.editBtn.hidden = true;
        els.hint.innerHTML = "Picking is closed. Resolve the conflicts below.";
        await maybeOpenDuel();
      }
    } catch (e) {}
  }

  init();
})();
