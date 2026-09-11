// Picker page: choose artists, submit, edit, resubmit.
(function () {
  const NAME_KEY = "acl_name";
  let name = null;
  let selected = new Set();
  let locked = false; // true after a successful submit (read-only until Edit)
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

  function applyLockUI() {
    const grids = els.grid.querySelectorAll(".grid");
    grids.forEach((g) => g.classList.toggle("locked", locked));
    els.submitBtn.hidden = locked;
    els.editBtn.hidden = !locked;
    els.hint.innerHTML = locked
      ? `Submitted <b>${selected.size}</b> pick${selected.size === 1 ? "" : "s"}. Hit <b>Edit</b> to change them.`
      : `Tap the artists you want to see. Hit <b>Submit</b> when you're set.`;
  }

  function decorateBox(box, artist) {
    const check = document.createElement("span");
    check.className = "check";
    check.textContent = "✓";
    box.appendChild(check);
    box.addEventListener("click", () => {
      if (locked) return;
      const id = artist.id;
      if (selected.has(id)) { selected.delete(id); box.classList.remove("selected"); }
      else { selected.add(id); box.classList.add("selected"); }
      haptic();
    });
  }

  function repaintSelections() {
    els.grid.querySelectorAll(".box").forEach((b) => {
      b.classList.toggle("selected", selected.has(b.dataset.id));
    });
  }

  async function submit() {
    if (!name) { openModal(); return; }
    els.submitBtn.disabled = true;
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, picks: [...selected] }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "submit failed");
      locked = true;
      applyLockUI();
      toast("Submitted! 🎉");
    } catch (e) {
      toast("Error: " + e.message);
    } finally {
      els.submitBtn.disabled = false;
    }
  }

  function edit() {
    locked = false;
    applyLockUI();
    toast("Edit mode");
  }

  function openModal() {
    els.modalBg.classList.add("show");
    els.nameInput.focus();
  }
  function closeModal() { els.modalBg.classList.remove("show"); }

  async function setName(n) {
    name = n.trim();
    if (!name) return;
    localStorage.setItem(NAME_KEY, name);
    closeModal();
    // Load any previously-saved picks for this name so they can edit.
    try {
      const me = await fetch("/api/me?name=" + encodeURIComponent(name)).then((r) => r.json());
      if (me.picks && me.picks.length) {
        selected = new Set(me.picks);
        locked = true; // they already submitted before
        repaintSelections();
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
