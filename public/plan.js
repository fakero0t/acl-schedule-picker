// Group-plan view: a per-day chronological timeline of shuffle-deck cards.
// Each slot (a single show, or a clash) renders as a deck of faces you can
// slide through with ‹ › arrows or a touch swipe.
(function () {
  const POLL_MS = 3000;
  const esc = ACLGrid.escapeHtml;

  const els = {
    days: document.getElementById("days"),
    strip: document.getElementById("planStrip"),
    deck: document.getElementById("planDeck"),
  };

  let planData = null;
  let lastJson = null;
  let activeDay = null;
  // slotKey -> index of the face currently at the front of that deck.
  // Persists across re-renders so polling / day switches don't reset a swipe.
  const frontIndex = {};

  function slotKey(slot) {
    return slot.type === "clash" ? `c:${slot.day}:${slot.id}` : `s:${slot.day}:${slot.show.id}`;
  }

  // ---- faces ----
  // A "face" is one card in a slot's deck. single slots have exactly one;
  // clash slots have one face per option, plus a leading split-face when the
  // group decided to split into groups instead of picking one show.
  function facesForSlot(slot) {
    if (slot.type === "single") return [{ kind: "single", show: slot.show }];
    const { options, winner } = slot;
    if (winner === "split") {
      return [{ kind: "split", options }, ...options.map((o) => ({ kind: "option", option: o }))];
    }
    if (winner) {
      const winOpt = options.find((o) => o.id === winner);
      const rest = options.filter((o) => o.id !== winner);
      return (winOpt ? [winOpt, ...rest] : options).map((o) => ({ kind: "option", option: o }));
    }
    return options.map((o) => ({ kind: "option", option: o }));
  }

  function faceTimeLabel(face) {
    if (face.kind === "single") return face.show.timeLabel;
    if (face.kind === "split") return (face.options[0] && face.options[0].timeLabel) || "";
    return face.option.timeLabel;
  }

  function faceCardHtml(face, slot) {
    if (face.kind === "single") {
      const s = face.show;
      const who = (s.voters || []).map(esc).join(", ");
      const n = s.count || 0;
      return `<div class="deck-card">
        <div class="dc-name">${esc(s.name)}</div>
        <div class="dc-meta">${esc(s.timeLabel)} · ${esc(s.stage)}</div>
        <div class="dc-count">${n} pick${n === 1 ? "" : "s"}</div>
        ${who ? `<div class="dc-who">${who}</div>` : ""}
      </div>`;
    }
    if (face.kind === "split") {
      const rows = face.options.map((o) => {
        const who = (o.voters || []).map(esc).join(", ");
        return `<div class="dc-split-row">
          <span class="dc-split-name">${esc(o.name)}</span>
          <span class="dc-split-who${who ? "" : " dim"}">${who || "no leaners yet"}</span>
        </div>`;
      }).join("");
      return `<div class="deck-card split win">
        <div class="dc-badge">🤝 split decision</div>
        <div class="dc-name">Split into groups</div>
        ${rows}
      </div>`;
    }
    // option
    const o = face.option;
    const n = (slot.tally && slot.tally[o.id]) || 0;
    const who = ((slot.chosenBy && slot.chosenBy[o.id]) || []).map(esc).join(", ");
    const isWin = slot.winner === o.id;
    return `<div class="deck-card${isWin ? " win" : ""}">
      ${isWin ? `<div class="dc-badge">👑 group pick</div>` : ""}
      <div class="dc-name">${esc(o.name)}</div>
      <div class="dc-meta">${esc(o.timeLabel)} · ${esc(o.stage)}</div>
      <div class="dc-count">${n} vote${n === 1 ? "" : "s"}</div>
      ${who ? `<div class="dc-who">${who}</div>` : ""}
    </div>`;
  }

  // ---- shuffle-deck positioning ----
  // delta = face index - current front index. 0 = front (on top), positive =
  // stacked behind (fanned out, capped visually at ~3 deep), negative =
  // already passed (slid off to the left, hidden).
  function setCardStyle(el, delta) {
    let transform, opacity, z, pe;
    if (delta === 0) {
      transform = "translate(0,0) rotate(0deg) scale(1)";
      opacity = 1; z = 50; pe = "auto";
    } else if (delta < 0) {
      transform = "translate(-46px, 8px) rotate(-8deg) scale(.92)";
      opacity = 0; z = 1; pe = "none";
    } else {
      const d = Math.min(delta, 4);
      transform = `translate(${d * 14}px, ${d * 10}px) rotate(${d * 3}deg) scale(${1 - d * 0.05})`;
      opacity = d <= 3 ? 1 - d * 0.16 : 0;
      z = 40 - d; pe = "none";
    }
    el.style.transform = transform;
    el.style.opacity = String(opacity);
    el.style.zIndex = String(z);
    el.style.pointerEvents = pe;
  }

  function slotHtml(slot) {
    const faces = facesForSlot(slot);
    const key = slotKey(slot);
    if (!(key in frontIndex)) frontIndex[key] = 0;
    frontIndex[key] = Math.max(0, Math.min(faces.length - 1, frontIndex[key]));
    const front = frontIndex[key];
    const cardsHtml = faces.map((f) => faceCardHtml(f, slot)).join("");
    const showArrows = faces.length > 1;
    const noneN = slot.type === "clash" ? (slot.tally["none"] || 0) : 0;
    const notes = [];
    if (slot.type === "clash" && slot.winner === null) notes.push(`<span class="deck-note undecided">Not decided yet</span>`);
    if (noneN) notes.push(`<span class="deck-note">(${noneN} had no preference)</span>`);
    return `<div class="slot">
      <div class="slot-time">${esc(faceTimeLabel(faces[front]))}</div>
      <div class="deck" data-count="${faces.length}">
        <div class="deck-stack">${cardsHtml}</div>
        ${showArrows ? `<button class="deck-nav prev" aria-label="Previous option" ${front === 0 ? "disabled" : ""}>‹</button>
        <button class="deck-nav next" aria-label="Next option" ${front === faces.length - 1 ? "disabled" : ""}>›</button>` : ""}
      </div>
      ${notes.length ? `<div class="deck-notes">${notes.join("")}</div>` : ""}
    </div>`;
  }

  function wireDeck(slotEl, deckEl, slot) {
    const faces = facesForSlot(slot);
    const key = slotKey(slot);
    const cardEls = Array.from(deckEl.querySelectorAll(".deck-card"));
    const prevBtn = deckEl.querySelector(".deck-nav.prev");
    const nextBtn = deckEl.querySelector(".deck-nav.next");
    const timeEl = slotEl.querySelector(".slot-time");

    function apply() {
      const front = frontIndex[key] || 0;
      cardEls.forEach((el, i) => setCardStyle(el, i - front));
      if (prevBtn) prevBtn.disabled = front === 0;
      if (nextBtn) nextBtn.disabled = front === faces.length - 1;
      if (timeEl) timeEl.textContent = faceTimeLabel(faces[front]);
    }

    function go(delta) {
      const cur = frontIndex[key] || 0;
      const next = Math.max(0, Math.min(faces.length - 1, cur + delta));
      if (next === cur) return;
      frontIndex[key] = next;
      apply();
    }

    if (prevBtn) prevBtn.addEventListener("click", () => go(-1));
    if (nextBtn) nextBtn.addEventListener("click", () => go(1));

    let sx = 0, sy = 0, dx = 0, dy = 0, tracking = false;
    deckEl.addEventListener("touchstart", (e) => {
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY; dx = 0; dy = 0; tracking = true;
    }, { passive: true });
    deckEl.addEventListener("touchmove", (e) => {
      if (!tracking) return;
      const t = e.touches[0];
      dx = t.clientX - sx; dy = t.clientY - sy;
    }, { passive: true });
    deckEl.addEventListener("touchend", () => {
      if (!tracking) return;
      tracking = false;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
    }, { passive: true });

    apply();
  }

  function anySlotsAnywhere() {
    return planData && Object.values(planData.slotsByDay).some((arr) => arr.length > 0);
  }

  function renderStrip() {
    if (!anySlotsAnywhere()) {
      els.strip.textContent = "Nothing to show yet — come back once picks and duels are in.";
      return;
    }
    const n = planData.totalDone || 0;
    els.strip.textContent = `${n} ${n === 1 ? "friend has" : "friends have"} finished the duels`;
  }

  function renderSlots() {
    const slots = (planData.slotsByDay[activeDay] || []);
    if (!slots.length) {
      els.deck.innerHTML = `<div class="plan-empty">Nothing locked in for this day yet.</div>`;
      return;
    }
    els.deck.innerHTML = slots.map(slotHtml).join("");
    const slotEls = Array.from(els.deck.querySelectorAll(".slot"));
    slots.forEach((slot, i) => {
      const slotEl = slotEls[i];
      const deckEl = slotEl && slotEl.querySelector(".deck");
      if (deckEl) wireDeck(slotEl, deckEl, slot);
    });
  }

  function renderAll() {
    renderStrip();
    renderSlots();
  }

  function showDay(key) {
    activeDay = key;
    renderSlots();
  }

  async function refresh() {
    let text;
    try { text = await fetch("/api/plan").then((r) => r.text()); }
    catch (e) { return; }
    if (text === lastJson) return; // unchanged: skip re-render so an in-progress swipe isn't disrupted
    lastJson = text;
    let data;
    try { data = JSON.parse(text); } catch (e) { return; }
    planData = data;
    if (!planData.slotsByDay[activeDay]) {
      activeDay = planData.days[0] ? planData.days[0].key : activeDay;
    }
    renderAll();
  }

  async function init() {
    let text = null;
    try { text = await fetch("/api/plan").then((r) => r.text()); }
    catch (e) { /* handled below */ }
    if (text) {
      lastJson = text;
      try { planData = JSON.parse(text); } catch (e) { planData = null; }
    }
    if (planData && planData.days && planData.days.length) {
      activeDay = planData.days[0].key;
      ACLGrid.buildDayTabs(els.days, planData.days, (key) => showDay(key));
      renderAll();
    } else {
      els.strip.textContent = "Couldn't load the plan.";
    }
    setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }

  init();
})();
