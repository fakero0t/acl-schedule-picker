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

  async function init() {
    const data = await fetch("/api/schedule").then((r) => r.json());
    ACLGrid.buildDayTabs(els.days, data.days, (dayKey) => gridApi.show(dayKey));
    gridApi = ACLGrid.render(els.grid, data, decorateBox);

    els.submitBtn.addEventListener("click", submit);
    els.editBtn.addEventListener("click", edit);
    els.nameGo.addEventListener("click", () => setName(els.nameInput.value));
    els.nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") setName(els.nameInput.value); });

    const saved = localStorage.getItem(NAME_KEY);
    if (saved) setName(saved);
    else openModal();

    applyLockUI();
  }

  init();
})();
