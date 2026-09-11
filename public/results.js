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
      const voters = box._voters || [];
      if (!voters.length) return;
      els.tipTitle.textContent = `${voters.length} ${voters.length === 1 ? "vote" : "votes"}`;
      els.tipNames.textContent = voters.join(", ");
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
    const maxCount = Math.max(1, ...Object.values(counts));

    els.countStrip.textContent = totalPeople === 0
      ? "No submissions yet — be the first to pick!"
      : `${totalPeople} ${totalPeople === 1 ? "friend has" : "friends have"} submitted`;

    for (const artist of scheduleData.artists) {
      const box = boxById[artist.id];
      if (!box) continue;
      const c = counts[artist.id] || 0;
      const v = voters[artist.id] || [];
      box._voters = v;
      const countEl = box.querySelector(".count");
      countEl.textContent = c;
      box.classList.toggle("picked", c > 0);

      if (c === 0) {
        box.style.background = "";
        box.classList.remove("hot");
      } else {
        const ratio = c / maxCount;
        box.style.background = rampColor(ratio);
        box.classList.toggle("hot", ratio >= 0.6);
      }
    }
  }

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
