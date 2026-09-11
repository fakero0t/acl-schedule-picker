// Shared schedule-grid renderer used by both the picker (index) and results pages.
// Builds one CSS-grid per day; a decorator callback lets each page style/handle boxes.
window.ACLGrid = (function () {
  function stageLabelHtml(stage) {
    if (stage.key === "titos") return `TITO'S<br><small>HANDMADE VODKA</small>`;
    if (stage.key === "amex") return `AMERICAN<br>EXPRESS`;
    return stage.label.toUpperCase();
  }

  // data: {days, stages, artists, totalRows, hourLabels}
  // decorate(boxEl, artist): per-page hook (classes, badges, click handlers)
  function render(root, data, decorate) {
    root.innerHTML = "";
    const dayEls = {};

    data.days.forEach((day, di) => {
      const dayEl = document.createElement("section");
      dayEl.className = "day" + (di === 0 ? " active" : "");
      dayEl.dataset.day = day.key;

      const scroller = document.createElement("div");
      scroller.className = "scroller";

      const grid = document.createElement("div");
      grid.className = "grid";
      // header row (1) + one row per 15-min slot
      grid.style.gridTemplateRows = `auto repeat(${data.totalRows}, var(--row-h))`;

      // top-left axis corner
      const corner = document.createElement("div");
      corner.className = "axis-head";
      corner.style.gridColumn = "1";
      grid.appendChild(corner);

      // stage headers
      data.stages.forEach((stage, si) => {
        const h = document.createElement("div");
        h.className = "stage-head";
        h.style.gridColumn = String(si + 2);
        h.innerHTML = stageLabelHtml(stage);
        grid.appendChild(h);
      });

      // per-stage background bands (empty-slot look), rows 2..end
      data.stages.forEach((stage, si) => {
        const bg = document.createElement("div");
        bg.className = "col-bg";
        bg.style.gridColumn = String(si + 2);
        bg.style.gridRow = `2 / ${data.totalRows + 2}`;
        grid.appendChild(bg);
      });

      // hour axis labels
      data.hourLabels.forEach((h) => {
        const el = document.createElement("div");
        el.className = "hour";
        el.style.gridRow = String(h.row + 1); // +1 for header row
        el.textContent = h.label;
        grid.appendChild(el);
      });

      // artist boxes for this day
      const stageIndex = {};
      data.stages.forEach((s, i) => (stageIndex[s.key] = i));
      data.artists
        .filter((a) => a.day === day.key)
        .forEach((a) => {
          const box = document.createElement("div");
          box.className = "box";
          box.dataset.id = a.id;
          box.style.gridColumn = String(stageIndex[a.stage] + 2);
          box.style.gridRow = `${a.rowStart + 1} / ${a.rowEnd + 1}`;
          box.innerHTML =
            `<span class="nm">${escapeHtml(a.name)}</span>` +
            `<span class="tm">${escapeHtml(a.timeLabel)}</span>`;
          if (decorate) decorate(box, a);
          grid.appendChild(box);
        });

      scroller.appendChild(grid);
      dayEl.appendChild(scroller);
      root.appendChild(dayEl);
      dayEls[day.key] = dayEl;
    });

    return {
      show(dayKey) {
        Object.values(dayEls).forEach((el) => el.classList.remove("active"));
        if (dayEls[dayKey]) dayEls[dayKey].classList.add("active");
      },
    };
  }

  function buildDayTabs(container, days, onSelect) {
    container.innerHTML = "";
    const tabs = {};
    days.forEach((d, i) => {
      const b = document.createElement("button");
      b.className = "day-tab" + (i === 0 ? " active" : "");
      b.textContent = d.label;
      b.addEventListener("click", () => {
        Object.values(tabs).forEach((t) => t.classList.remove("active"));
        b.classList.add("active");
        onSelect(d.key);
      });
      tabs[d.key] = b;
      container.appendChild(b);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  return { render, buildDayTabs, escapeHtml };
})();
