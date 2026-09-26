// Group-plan view: winning show per clash, vote split, who chose what.
(function () {
  const POLL_MS = 3000;
  const esc = ACLGrid.escapeHtml;
  const els = {
    strip: document.getElementById("planStrip"),
    list: document.getElementById("planList"),
  };

  function card(clash) {
    const rows = clash.options.map((o) => {
      const n = clash.tally[o.id] || 0;
      const who = (clash.chosenBy[o.id] || []).map(esc).join(", ");
      const isWin = clash.winner === o.id;
      const win = isWin ? " win" : "";
      return `<div class="plan-opt${win}">
          <div class="po-top"><span class="po-name">${esc(o.name)}</span>
            <span class="po-count">${n}</span></div>
          <div class="po-meta">${esc(o.timeLabel)} · ${esc(o.stage)}${isWin ? " · 👑 group pick" : ""}</div>
          ${who ? `<div class="po-who">${who}</div>` : ""}
        </div>`;
    }).join("");
    const noneN = clash.tally["none"] || 0;
    const noneWho = (clash.chosenBy["none"] || []).map(esc).join(", ");
    const noneRow = noneN
      ? `<div class="plan-opt none"><div class="po-top"><span class="po-name">No preference</span>
           <span class="po-count">${noneN}</span></div>
           ${noneWho ? `<div class="po-who">${noneWho}</div>` : ""}</div>`
      : "";
    return `<div class="plan-card"><div class="plan-day">${esc(clash.day.toUpperCase())}</div>${rows}${noneRow}</div>`;
  }

  async function refresh() {
    let data;
    try { data = await fetch("/api/duel/results").then((r) => r.json()); }
    catch (e) { return; }
    if (!data.clashes?.length) {
      els.strip.textContent = "No clashes to resolve yet.";
      els.list.innerHTML = "";
      return;
    }
    els.strip.textContent = `${data.totalDone} ${data.totalDone === 1 ? "friend has" : "friends have"} finished the duels`;
    els.list.innerHTML = data.clashes.map(card).join("");
  }

  async function init() {
    await refresh();
    setInterval(refresh, POLL_MS);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  }
  init();
})();
