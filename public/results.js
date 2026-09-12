// Results page: live master view — counts, popularity color, who-voted tooltip.
(function () {
  const POLL_MS = 3000;
  let gridApi = null;
  let scheduleData = null;
  const boxById = {}; // id -> box element

  const els = {
    days: document.getElementById("days"),
    grid: document.getElementById("grid"),
    countStrip: document.getElementById("countStrip"),
    tip: document.getElementById("tip"),
    tipTitle: document.querySelector("#tip .t-title"),
    tipNames: document.querySelector("#tip .t-names"),
  };

  // popularity color ramp: cream -> orange -> hot pink, by ratio 0..1
  const C0 = [252, 225, 162]; // cream
  const C1 = [247, 161, 58];  // orange
  const C2 = [255, 46, 154];  // pink
  function lerp(a, b, t) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
  function rampColor(ratio) {
    const rgb = ratio <= 0.5 ? lerp(C0, C1, ratio / 0.5) : lerp(C1, C2, (ratio - 0.5) / 0.5);
    return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  }

  function decorateBox(box, artist) {
    const count = document.createElement("span");
    count.className = "count";
    box.appendChild(count);
    box.classList.add("result");
    boxById[artist.id] = box;

    const showTip = (ev) => {
      const v = box._voters || { definitely: [], maybe: [] };
      const total = v.definitely.length + v.maybe.length;
      if (!total) return;
      els.tipTitle.textContent = `${total} ${total === 1 ? "vote" : "votes"}`;
      let html = "";
      if (v.definitely.length) html += `<div class="grp"><span class="lab def">Definitely</span> ${escapeHtml(v.definitely.join(", "))}</div>`;
      if (v.maybe.length) html += `<div class="grp"><span class="lab maybe">Maybe</span> ${escapeHtml(v.maybe.join(", "))}</div>`;
      els.tipNames.innerHTML = html;
      els.tip.classList.add("show");
      moveTip(ev);
    };
    const moveTip = (ev) => {
      const t = ev.touches ? ev.touches[0] : ev;
      let x = t.clientX + 14, y = t.clientY + 14;
      const w = els.tip.offsetWidth, h = els.tip.offsetHeight;
      if (x + w > window.innerWidth - 8) x = t.clientX - w - 14;
      if (y + h > window.innerHeight - 8) y = t.clientY - h - 14;
      els.tip.style.left = x + "px";
      els.tip.style.top = y + "px";
    };
    const hideTip = () => els.tip.classList.remove("show");

    box.addEventListener("mouseenter", showTip);
    box.addEventListener("mousemove", moveTip);
    box.addEventListener("mouseleave", hideTip);
    box.addEventListener("touchstart", (e) => { showTip(e); }, { passive: true });
    box.addEventListener("touchend", hideTip);
  }

  function paint(results) {
    const { counts = {}, voters = {}, totalPeople = 0 } = results;
    const maxWeighted = Math.max(1, ...Object.values(counts).map((c) => c.weighted || 0));

    els.countStrip.textContent = totalPeople === 0
      ? "No submissions yet — be the first to pick!"
      : `${totalPeople} ${totalPeople === 1 ? "friend has" : "friends have"} submitted`;

    for (const artist of scheduleData.artists) {
      const box = boxById[artist.id];
      if (!box) continue;
      const c = counts[artist.id] || { definitely: 0, maybe: 0, total: 0, weighted: 0 };
      box._voters = voters[artist.id] || { definitely: [], maybe: [] };
      const countEl = box.querySelector(".count");
      let html = "";
      if (c.definitely) html += `<span class="d">${c.definitely}▲</span>`;
      if (c.maybe) html += `<span class="m">${c.maybe}~</span>`;
      countEl.innerHTML = html;
      box.classList.toggle("picked", c.total > 0);
      box.classList.toggle("empty", c.total === 0); // hide artists nobody picked

      if (c.total === 0) {
        box.style.background = "";
        box.classList.remove("hot");
      } else {
        const ratio = c.weighted / maxWeighted;
        box.style.background = rampColor(ratio);
        box.classList.toggle("hot", ratio >= 0.6);
      }
    }
  }

  const escapeHtml = ACLGrid.escapeHtml;

  async function refresh() {
    try {
      const results = await fetch("/api/results").then((r) => r.json());
      paint(results);
    } catch (e) { /* keep last paint on transient error */ }
  }

  async function init() {
    scheduleData = await fetch("/api/schedule").then((r) => r.json());
    ACLGrid.buildDayTabs(els.days, scheduleData.days, (dayKey) => gridApi.show(dayKey));
    gridApi = ACLGrid.render(els.grid, scheduleData, decorateBox);
    await refresh();
    setInterval(refresh, POLL_MS);
    // refresh promptly when tab regains focus
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }

  init();
})();
