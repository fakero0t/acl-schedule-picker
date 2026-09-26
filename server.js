const path = require("path");
const fs = require("fs");
const express = require("express");
const schedule = require("./data/schedule");
const { createDb } = require("./db");
const { computeClashes } = require("./data/clashes");

const MAX_NAME = 40;
const TIERS = new Set(["definitely", "maybe"]);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev";
const PHASES = new Set(["picking", "duel"]);
const DAY_KEYS = new Set(schedule.DAYS.map((d) => d.key));
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/; // 24h "HH:MM"
const EVENT_LIMITS = { name: 80, description: 500, location: 120 };
const EVENT_KINDS = new Set(["event", "hangout"]); // outside event | pregame / other

// Validate an incoming weekend event. -> { event } or { error }.
function parseEvent(body) {
  const b = body || {};
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const ev = {
    day: str(b.day),
    start: str(b.start),
    end: str(b.end) || null,
    name: str(b.name),
    description: str(b.description),
    location: str(b.location),
    kind: str(b.kind) || "event",
  };
  if (!EVENT_KINDS.has(ev.kind)) return { error: "kind must be event or hangout" };
  if (!DAY_KEYS.has(ev.day)) return { error: "day must be one of fri, sat, sun" };
  if (!TIME_RE.test(ev.start)) return { error: "start must be a time like 18:30" };
  if (ev.end && !TIME_RE.test(ev.end)) return { error: "end must be a time like 21:00" };
  if (!ev.name) return { error: "name is required" };
  for (const [k, max] of Object.entries(EVENT_LIMITS)) {
    if (ev[k].length > max) return { error: `${k} too long` };
  }
  return { event: ev };
}

// Normalize a stored/incoming picks array into [{id, tier}], keeping only known
// ids, de-duped by id (last wins). Back-compat: a bare string id => "definitely".
function normalizePicks(picks) {
  if (!Array.isArray(picks)) return [];
  const byId = new Map();
  for (const p of picks) {
    const id = typeof p === "string" ? p : p && p.id;
    if (!schedule.VALID_IDS.has(id)) continue;
    const tier = typeof p === "object" && p.tier === "maybe" ? "maybe" : "definitely";
    byId.set(id, { id, tier });
  }
  return [...byId.values()];
}

// Build an Express app around a given db handle (so tests can inject :memory:).
function createApp(db) {
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(express.static(path.join(__dirname, "public")));

  // Static schedule + layout metadata for the client to render the grid.
  app.get("/api/schedule", (_req, res) => {
    res.json({
      days: schedule.DAYS,
      stages: schedule.STAGES,
      artists: schedule.ARTISTS,
      totalRows: schedule.TOTAL_ROWS,
      hourLabels: schedule.HOUR_LABELS,
      slotMin: schedule.SLOT_MIN,
    });
  });

  // Aggregated results: per-artist tiered counts + who voted at each tier.
  app.get("/api/results", (_req, res) => {
    const submissions = db.all();
    const counts = {}; // id -> { definitely, maybe, total, weighted }
    const voters = {}; // id -> { definitely: [names], maybe: [names] }
    for (const s of submissions) {
      for (const { id, tier } of normalizePicks(s.picks)) {
        const c = (counts[id] = counts[id] || { definitely: 0, maybe: 0, total: 0, weighted: 0 });
        const v = (voters[id] = voters[id] || { definitely: [], maybe: [] });
        c[tier] += 1;
        c.total += 1;
        c.weighted += tier === "definitely" ? 1 : 0.5;
        v[tier].push(s.name);
      }
    }
    res.json({
      totalPeople: submissions.length,
      counts,
      voters,
      people: submissions.map((s) => s.name),
    });
  });

  app.get("/api/phase", (_req, res) => {
    res.json({ phase: db.getPhase() });
  });

  app.post("/api/admin/phase", (req, res) => {
    const { token, phase } = req.body || {};
    if (token !== ADMIN_TOKEN) return res.status(403).json({ error: "forbidden" });
    if (!PHASES.has(phase)) return res.status(400).json({ error: "invalid phase" });
    db.setPhase(phase);
    res.json({ ok: true, phase });
  });

  // Build clashes plus the counts/voters needed to enrich them.
  function buildClashes() {
    const submissions = db.all();
    const counts = {};  // id -> { total }
    const voters = {};  // id -> [names]  (flat, any tier)
    const pickers = {}; // id -> { definitely: [names], maybe: [names] }
    for (const s of submissions) {
      for (const { id, tier } of normalizePicks(s.picks)) {
        counts[id] = counts[id] || { total: 0 };
        counts[id].total += 1;
        (voters[id] = voters[id] || []).push(s.name);
        const pt = (pickers[id] = pickers[id] || { definitely: [], maybe: [] });
        pt[tier === "maybe" ? "maybe" : "definitely"].push(s.name);
      }
    }
    const clashes = computeClashes(schedule.ARTISTS, counts).map((c) => ({
      ...c,
      options: c.options.map((o) => ({
        ...o,
        count: (counts[o.id] && counts[o.id].total) || 0,
        voters: voters[o.id] || [],
        definitely: (pickers[o.id] && pickers[o.id].definitely) || [],
        maybe: (pickers[o.id] && pickers[o.id].maybe) || [],
      })),
    }));
    return { submissions, clashes, counts, voters };
  }

  // Tally a clash's duel answers and pick the winning slot.
  // "none" never wins. "split" competes but loses ties to a concrete show
  // (prefer a real plan). Options are pre-sorted by rowStart, so the first
  // show to reach the max wins show-vs-show ties (earliest start).
  function resolveClash(c, submissions) {
    const tally = {};
    const chosenBy = {};
    for (const s of submissions) {
      const choice = s.duelAnswers[c.id];
      if (!choice) continue;
      tally[choice] = (tally[choice] || 0) + 1;
      (chosenBy[choice] = chosenBy[choice] || []).push(s.name);
    }
    let winner = null, best = 0;
    for (const o of c.options) {
      const v = tally[o.id] || 0;
      if (v > best) { best = v; winner = o.id; }
    }
    const splitVotes = tally["split"] || 0;
    if (splitVotes > best) { winner = "split"; best = splitVotes; } // strictly greater => show wins ties
    return { tally, chosenBy, winner };
  }

  app.get("/api/duel", (req, res) => {
    const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
    const phase = db.getPhase();
    if (phase !== "duel") return res.json({ phase, done: false, myAnswers: {}, clashes: [], hasSubmission: false });
    const { clashes } = buildClashes();
    const me = name ? db.getByName(name) : null;
    res.json({
      phase,
      done: me ? me.duelDone : false,
      myAnswers: me ? me.duelAnswers : {},
      clashes,
      hasSubmission: !!me,
    });
  });

  app.post("/api/duel/answer", (req, res) => {
    if (db.getPhase() !== "duel") return res.status(409).json({ error: "duel not open" });
    const { name, clashId, choice } = req.body || {};
    const nm = typeof name === "string" ? name.trim() : "";
    if (!nm) return res.status(400).json({ error: "name is required" });
    const me = db.getByName(nm);
    if (!me) return res.status(403).json({ error: "no submission for this name" });
    const { clashes } = buildClashes();
    const clash = clashes.find((c) => c.id === clashId);
    if (!clash) return res.status(400).json({ error: "unknown clashId" });
    const valid = choice === "none" || choice === "split" || clash.options.some((o) => o.id === choice);
    if (!valid) return res.status(400).json({ error: "invalid choice" });
    db.saveDuelAnswer(nm, clashId, choice);
    res.json({ ok: true });
  });

  app.post("/api/duel/submit", (req, res) => {
    if (db.getPhase() !== "duel") return res.status(409).json({ error: "duel not open" });
    const nm = typeof (req.body && req.body.name) === "string" ? req.body.name.trim() : "";
    if (!nm) return res.status(400).json({ error: "name is required" });
    db.submitDuel(nm);
    res.json({ ok: true });
  });

  app.get("/api/duel/results", (_req, res) => {
    const { submissions, clashes } = buildClashes();
    const out = clashes.map((c) => {
      const { tally, chosenBy, winner } = resolveClash(c, submissions);
      return { id: c.id, day: c.day, options: c.options, tally, chosenBy, winner };
    });
    res.json({ totalDone: submissions.filter((s) => s.duelDone).length, clashes: out });
  });

  app.get("/api/plan", (_req, res) => {
    const { submissions, clashes, counts, voters } = buildClashes();
    const inClash = new Set();
    clashes.forEach((c) => c.options.forEach((o) => inClash.add(o.id)));
    const artistById = {};
    schedule.ARTISTS.forEach((a) => { artistById[a.id] = a; });

    const slotsByDay = {};
    schedule.DAYS.forEach((d) => { slotsByDay[d.key] = []; });

    // Clash slots (each a deck of the overlapping shows).
    for (const c of clashes) {
      const { tally, chosenBy, winner } = resolveClash(c, submissions);
      slotsByDay[c.day].push({
        type: "clash", id: c.id, day: c.day, rowStart: c.options[0].rowStart,
        options: c.options, tally, chosenBy, winner,
      });
    }
    // Single slots: every picked show that is NOT part of a clash.
    for (const id of Object.keys(counts)) {
      if (inClash.has(id)) continue;
      const a = artistById[id];
      if (!a) continue;
      slotsByDay[a.day].push({
        type: "single", day: a.day, rowStart: a.rowStart,
        show: { id, name: a.name, stage: a.stage, timeLabel: a.timeLabel, rowStart: a.rowStart,
                count: counts[id].total, voters: voters[id] || [] },
      });
    }
    // Chronological order within each day.
    Object.keys(slotsByDay).forEach((k) => slotsByDay[k].sort((x, y) => x.rowStart - y.rowStart));

    res.json({
      totalDone: submissions.filter((s) => s.duelDone).length,
      days: schedule.DAYS.map((d) => ({ key: d.key, label: d.label })),
      slotsByDay,
    });
  });

  app.get("/plan", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "plan.html"));
  });

  app.get("/admin", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "admin.html"));
  });

  // Submit / update one person's picks. Upserts by name.
  // picks: array of { id, tier } (tier "definitely"|"maybe"); bare id strings ok.
  app.post("/api/submit", (req, res) => {
    if (db.getPhase() !== "picking") {
      return res.status(409).json({ error: "picking is closed" });
    }
    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const picks = Array.isArray(body.picks) ? body.picks : null;

    if (!name) return res.status(400).json({ error: "name is required" });
    if (name.length > MAX_NAME) return res.status(400).json({ error: "name too long" });
    if (!picks) return res.status(400).json({ error: "picks must be an array" });

    // Reject unknown ids or bad tiers outright (don't silently drop).
    for (const p of picks) {
      const id = typeof p === "string" ? p : p && p.id;
      if (!schedule.VALID_IDS.has(id)) {
        return res.status(400).json({ error: `unknown artist id: ${id}` });
      }
      if (typeof p === "object" && p.tier != null && !TIERS.has(p.tier)) {
        return res.status(400).json({ error: `invalid tier: ${p.tier}` });
      }
    }

    const clean = normalizePicks(picks);
    db.upsert(name, clean);
    res.json({ ok: true, name, picks: clean });
  });

  // Return the current person's saved picks (so a returning friend can edit).
  app.get("/api/me", (req, res) => {
    const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
    if (!name) return res.status(400).json({ error: "name is required" });
    const found = db.all().find((s) => s.name.toLowerCase() === name.toLowerCase());
    res.json({ name: found ? found.name : name, picks: found ? normalizePicks(found.picks) : [] });
  });

  // Weekend plans: shared list anyone can add to / edit / remove from.
  app.get("/api/events", (_req, res) => {
    res.json({ events: db.events() });
  });

  app.post("/api/events", (req, res) => {
    const { event, error } = parseEvent(req.body);
    if (error) return res.status(400).json({ error });
    res.json({ ok: true, event: db.addEvent(event) });
  });

  app.put("/api/events/:id", (req, res) => {
    const { event, error } = parseEvent(req.body);
    if (error) return res.status(400).json({ error });
    const updated = db.updateEvent(Number(req.params.id), event);
    if (!updated) return res.status(404).json({ error: "event not found" });
    res.json({ ok: true, event: updated });
  });

  app.delete("/api/events/:id", (req, res) => {
    if (!db.deleteEvent(Number(req.params.id))) return res.status(404).json({ error: "event not found" });
    res.json({ ok: true });
  });

  app.get("/weekend", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "weekend.html"));
  });

  app.get("/results", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "results.html"));
  });

  return app;
}

// Start the server only when run directly (not when imported by tests).
if (require.main === module) {
  const dataDir = path.join(__dirname, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = process.env.DB_PATH || path.join(dataDir, "picks.db");
  const db = createDb(dbPath);
  const app = createApp(db);
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`ACL Weekend 1 picker running on http://localhost:${port}  (db: ${dbPath})`);
  });
}

module.exports = { createApp, createDb };
