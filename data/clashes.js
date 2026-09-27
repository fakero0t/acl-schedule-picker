// Conflict detection: group voted-for, time-overlapping shows into MAXIMAL
// CLIQUES — each clique is a set of shows that all mutually overlap, i.e. a
// real "you can only be in one place" moment, and becomes one conflict/duel.
//
// Overlap is half-open [start, end): shows that merely touch (a.end == b.start)
// do NOT conflict. A show that bridges two non-overlapping neighbours (a
// staggered chain A–B–C where A and C don't overlap) appears in BOTH cliques
// {A,B} and {B,C}, so the non-overlapping endpoints can both survive.
const DAY_ORDER = { fri: 0, sat: 1, sun: 2 };

// artists: [{id, day, stage, name, timeLabel, rowStart, rowEnd}]
// counts:  { id -> { total } }
function computeClashes(artists, counts) {
  const voted = artists.filter((a) => (counts[a.id] && counts[a.id].total) > 0);

  const byDay = new Map();
  for (const a of voted) {
    if (!byDay.has(a.day)) byDay.set(a.day, []);
    byDay.get(a.day).push(a);
  }

  // Sweep-line: record the active set just before each interval ends, whenever
  // the set grew since the last record — that active set is a maximal clique.
  const cliques = []; // arrays of artist objects
  for (const shows of byDay.values()) {
    const events = [];
    shows.forEach((s, i) => {
      events.push({ t: s.rowStart, start: 1, i });
      events.push({ t: s.rowEnd, start: 0, i }); // ends sort before starts at same time
    });
    events.sort((e1, e2) => e1.t - e2.t || e1.start - e2.start);
    const active = new Set();
    let grew = false;
    for (const ev of events) {
      if (ev.start) {
        active.add(ev.i);
        grew = true;
      } else {
        if (grew && active.size >= 2) cliques.push([...active].map((i) => shows[i]));
        grew = false;
        active.delete(ev.i);
      }
    }
  }

  const clashes = cliques.map((members) => {
    const options = members
      .slice()
      .sort((a, b) => a.rowStart - b.rowStart || (a.id < b.id ? -1 : 1))
      .map((a) => ({ id: a.id, name: a.name, stage: a.stage, timeLabel: a.timeLabel, rowStart: a.rowStart, rowEnd: a.rowEnd }));
    const day = members[0].day;
    const sortedIds = members.map((m) => m.id).sort();
    const startMin = Math.min(...options.map((o) => o.rowStart));
    const endMax = Math.max(...options.map((o) => o.rowEnd));
    return {
      id: `${day}:${sortedIds.join("+")}`,
      day,
      timeLabel: `${startMin}–${endMax}`, // row-based span; client shows option times
      options,
    };
  });

  clashes.sort((a, b) =>
    (DAY_ORDER[a.day] - DAY_ORDER[b.day]) || (a.options[0].rowStart - b.options[0].rowStart));
  return clashes;
}

module.exports = { computeClashes };
