// Pure clash detection: cluster voted-for, time-overlapping shows per day.
const DAY_ORDER = { fri: 0, sat: 1, sun: 2 };

function overlaps(a, b) {
  return a.day === b.day && a.rowStart < b.rowEnd && b.rowStart < a.rowEnd;
}

// artists: [{id, day, stage, name, timeLabel, rowStart, rowEnd}]
// counts:  { id -> { total } }
function computeClashes(artists, counts) {
  const voted = artists.filter((a) => (counts[a.id] && counts[a.id].total) > 0);

  // Union-find over the overlap graph.
  const parent = new Map(voted.map((a) => [a.id, a.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  const union = (x, y) => { parent.set(find(x), find(y)); };
  for (let i = 0; i < voted.length; i++) {
    for (let j = i + 1; j < voted.length; j++) {
      if (overlaps(voted[i], voted[j])) union(voted[i].id, voted[j].id);
    }
  }

  // Group by root.
  const groups = new Map(); // root -> [artist]
  for (const a of voted) {
    const r = find(a.id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(a);
  }

  const clashes = [];
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const options = members
      .slice()
      .sort((a, b) => a.rowStart - b.rowStart || (a.id < b.id ? -1 : 1))
      .map((a) => ({ id: a.id, name: a.name, stage: a.stage, timeLabel: a.timeLabel, rowStart: a.rowStart, rowEnd: a.rowEnd }));
    const day = members[0].day;
    const sortedIds = members.map((m) => m.id).sort();
    const startMin = Math.min(...options.map((o) => o.rowStart));
    const endMax = Math.max(...options.map((o) => o.rowEnd));
    clashes.push({
      id: `${day}:${sortedIds.join("+")}`,
      day,
      timeLabel: `${startMin}–${endMax}`, // row-based span; client shows option times
      options,
    });
  }

  clashes.sort((a, b) =>
    (DAY_ORDER[a.day] - DAY_ORDER[b.day]) || (a.options[0].rowStart - b.options[0].rowStart));
  return clashes;
}

module.exports = { computeClashes };
