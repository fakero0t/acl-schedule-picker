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
    const voters = {};  // id -> [names]
    for (const s of submissions) {
      for (const { id } of normalizePicks(s.picks)) {
        counts[id] = counts[id] || { total: 0 };
        counts[id].total += 1;
        (voters[id] = voters[id] || []).push(s.name);
      }
    }
    const clashes = computeClashes(schedule.ARTISTS, counts).map((c) => ({
      ...c,
      options: c.options.map((o) => ({
        ...o,
        count: (counts[o.id] && counts[o.id].total) || 0,
        voters: voters[o.id] || [],
      })),
    }));
    return { submissions, clashes };
  }

  app.get("/api/duel", (req, res) => {
    const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
    const phase = db.getPhase();
    if (phase !== "duel") return res.json({ phase, done: false, myAnswers: {}, clashes: [] });
    const { clashes } = buildClashes();
    const me = name ? db.getByName(name) : null;
    res.json({
      phase,
      done: me ? me.duelDone : false,
      myAnswers: me ? me.duelAnswers : {},
      clashes,
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
    const valid = choice === "none" || clash.options.some((o) => o.id === choice);
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
      const tally = {};
      const chosenBy = {};
      for (const s of submissions) {
        const choice = s.duelAnswers[c.id];
        if (!choice) continue;
        tally[choice] = (tally[choice] || 0) + 1;
        (chosenBy[choice] = chosenBy[choice] || []).push(s.name);
      }
      // Winner: most-chosen real option ("none" excluded); tie -> earliest rowStart.
      let winner = null, best = -1;
      for (const o of c.options) {
        const v = tally[o.id] || 0;
        if (v > best) { best = v; winner = o.id; }
      }
      if (best <= 0) winner = null;
      return { id: c.id, day: c.day, options: c.options, tally, chosenBy, winner };
    });
    res.json({ totalDone: submissions.filter((s) => s.duelDone).length, clashes: out });
  });

  app.get("/plan", (_req, res) => {
    res.sendFile(path.join(__dirname, "public", "plan.html"));
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
