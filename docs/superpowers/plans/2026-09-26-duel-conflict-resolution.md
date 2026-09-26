# Duel Conflict Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After picking closes, present overlapping-show time clashes as a one-at-a-time quiz where friends vote where the group should go, with partial progress saved server-side, and tally the answers into a group-plan view.

**Architecture:** A global app phase (`picking` → `duel`) stored in a new SQLite `meta` table gates everything. A pure `data/clashes.js` module groups voted-for, time-overlapping shows into clash clusters. New duel endpoints serve/enrich/save/tally answers. The picker page becomes read-only in duel phase and opens a blocking modal; a new `/plan` page shows the group's winning show per clash.

**Tech Stack:** Node 22, Express 4, better-sqlite3, vanilla HTML/CSS/JS, `node:test`.

**Spec:** `docs/superpowers/specs/2026-09-26-duel-conflict-resolution-design.md`

## Global Constraints

- Node engine pinned to `22.x` (`package.json`) — do not change.
- No new npm dependencies; use existing Express + better-sqlite3 + vanilla JS only.
- Phase values are exactly the strings `"picking"` and `"duel"`.
- Duel choice values are an option's artist `id` or the sentinel string `"none"` (No preference).
- Admin flip is guarded by `process.env.ADMIN_TOKEN`, defaulting to `"dev"` when unset (local/test).
- Name matching is case-insensitive everywhere (matches existing `/api/me`).
- Artist ids look like `${day}-${stage}-${idx}` and are unique; `VALID_IDS` is the source of truth.
- Client UI must reuse the existing design system (Anton/Archivo fonts, existing CSS tokens, `.locked`, `.modal-bg`, `.btn` classes) — no native `confirm()`/`alert()`/dropdowns.
- Commit code only — never commit files under `docs/superpowers/`.

## Review Focus

- **Case-insensitive name on duel endpoints:** a person stored as `"Ary"` answering/submitting as `"ary"` must hit the same row — covered in Task 2 (`getByName`) and Task 4 (answer/submit).
- **Invalid duel input:** unknown `clashId`, or a `choice` that is neither a member option id nor `"none"`, must 400 (not silently drop) — covered in Task 4.
- **Vote freeze:** `POST /api/submit` must return 409 once phase is `duel`, so the clash set can't shift under the quiz — covered in Task 3.
- **Person with no submission:** answering a duel with a name that never submitted picks must be rejected (only pickers vote) — covered in Task 4.
- **No-clash duel phase:** duel phase with zero overlapping votes returns `clashes: []` so the client shows a done/empty state and never traps the user — covered in Task 4 and Task 5.

---

### Task 1: Pure clash-detection module

**Files:**
- Create: `data/clashes.js`
- Test: `test/clashes.test.js`

**Interfaces:**
- Consumes: nothing (pure function over plain data).
- Produces: `computeClashes(artists, counts) -> Array<{ id, day, timeLabel, options: Array<{ id, name, stage, timeLabel, rowStart, rowEnd }> }>`
  - `artists`: array shaped like `schedule.ARTISTS` items (`{ id, day, stage, name, timeLabel, rowStart, rowEnd }`).
  - `counts`: object `id -> { total }` (extra fields ignored).
  - Returns clash clusters (≥2 members) ordered by day order (`fri`,`sat`,`sun`) then earliest `rowStart`; options within a clash ordered by `rowStart` then `id`. Clash `id` is `` `${day}:${sortedMemberIds.join("+")}` ``.

- [ ] **Step 1: Write the failing test**

```javascript
// test/clashes.test.js
const test = require("node:test");
const assert = require("node:assert");
const { computeClashes } = require("../data/clashes");

// Three shows on fri: A(rows 5-9) and B(rows 8-12) overlap; C(rows 20-24) is alone.
const artists = [
  { id: "fri-x-0", day: "fri", stage: "x", name: "A", timeLabel: "1:00 – 2:00", rowStart: 5, rowEnd: 9 },
  { id: "fri-y-0", day: "fri", stage: "y", name: "B", timeLabel: "1:45 – 2:45", rowStart: 8, rowEnd: 12 },
  { id: "fri-z-0", day: "fri", stage: "z", name: "C", timeLabel: "4:00 – 5:00", rowStart: 20, rowEnd: 24 },
];

test("clusters voted overlapping shows and drops singletons + unvoted", () => {
  const counts = { "fri-x-0": { total: 2 }, "fri-y-0": { total: 1 }, "fri-z-0": { total: 3 } };
  const clashes = computeClashes(artists, counts);
  assert.equal(clashes.length, 1, "only A/B form a clash; C is alone");
  assert.deepEqual(clashes[0].options.map((o) => o.id), ["fri-x-0", "fri-y-0"]);
  assert.equal(clashes[0].id, "fri:fri-x-0+fri-y-0", "stable id from sorted member ids");
  assert.equal(clashes[0].day, "fri");
});

test("a show with no votes cannot be in a clash", () => {
  const counts = { "fri-x-0": { total: 2 } }; // B unvoted
  assert.equal(computeClashes(artists, counts).length, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/clashes.test.js`
Expected: FAIL — `Cannot find module '../data/clashes'`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// data/clashes.js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/clashes.test.js`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add data/clashes.js test/clashes.test.js
git commit -m "feat: pure clash-detection module for overlapping shows"
```

---

### Task 2: Persistence — phase + duel columns

**Files:**
- Modify: `db.js`
- Test: `test/db.test.js` (create)

**Interfaces:**
- Consumes: nothing new.
- Produces, on the object returned by `createDb(path)`:
  - `getPhase() -> "picking" | "duel"` (default `"picking"`).
  - `setPhase(phase) -> void`.
  - `getByName(name) -> { name, picks, duelAnswers, duelDone } | null` (case-insensitive; `picks`/`duelAnswers` parsed from JSON; `duelDone` boolean).
  - `saveDuelAnswer(name, clashId, choice) -> void` (merges one key into the person's `duel_answers` map; no-op if the name has no row).
  - `submitDuel(name) -> void` (sets `duel_done = 1`; no-op if no row).
  - `all()` now also returns `duelAnswers` (object) and `duelDone` (boolean) per row.

- [ ] **Step 1: Write the failing test**

```javascript
// test/db.test.js
const test = require("node:test");
const assert = require("node:assert");
const { createDb } = require("../db");

test("phase defaults to picking and can be set", () => {
  const db = createDb(":memory:");
  assert.equal(db.getPhase(), "picking");
  db.setPhase("duel");
  assert.equal(db.getPhase(), "duel");
});

test("duel answers save/merge case-insensitively and submit sets done", () => {
  const db = createDb(":memory:");
  db.upsert("Ary", [{ id: "fri-x-0", tier: "definitely" }]);
  db.saveDuelAnswer("ary", "c1", "fri-x-0");
  db.saveDuelAnswer("ARY", "c2", "none");
  const row = db.getByName("aRy");
  assert.deepEqual(row.duelAnswers, { c1: "fri-x-0", c2: "none" });
  assert.equal(row.duelDone, false);
  db.submitDuel("ary");
  assert.equal(db.getByName("Ary").duelDone, true);
});

test("getByName returns null for unknown name", () => {
  const db = createDb(":memory:");
  assert.equal(db.getByName("nobody"), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/db.test.js`
Expected: FAIL — `db.getPhase is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `db.js`, inside `createDb`, after the existing `submissions` table `exec`, add the migration + meta table, and extend the returned object. Replace the file's body with:

```javascript
// SQLite persistence. One row per person, keyed by name; picks stored as JSON.
const Database = require("better-sqlite3");

function createDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS submissions (
      name       TEXT PRIMARY KEY,
      picks      TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Migrate existing databases: add duel columns if absent.
  const cols = db.prepare(`PRAGMA table_info(submissions)`).all().map((c) => c.name);
  if (!cols.includes("duel_answers")) {
    db.exec(`ALTER TABLE submissions ADD COLUMN duel_answers TEXT NOT NULL DEFAULT '{}'`);
  }
  if (!cols.includes("duel_done")) {
    db.exec(`ALTER TABLE submissions ADD COLUMN duel_done INTEGER NOT NULL DEFAULT 0`);
  }

  const upsertStmt = db.prepare(`
    INSERT INTO submissions (name, picks, updated_at)
    VALUES (@name, @picks, @updated_at)
    ON CONFLICT(name) DO UPDATE SET
      picks = excluded.picks,
      updated_at = excluded.updated_at
  `);
  const allStmt = db.prepare(
    `SELECT name, picks, duel_answers, duel_done FROM submissions ORDER BY name COLLATE NOCASE`
  );
  const byNameStmt = db.prepare(
    `SELECT name, picks, duel_answers, duel_done FROM submissions WHERE name = ? COLLATE NOCASE`
  );
  const answerStmt = db.prepare(
    `UPDATE submissions SET duel_answers = @answers WHERE name = @name COLLATE NOCASE`
  );
  const doneStmt = db.prepare(
    `UPDATE submissions SET duel_done = 1 WHERE name = @name COLLATE NOCASE`
  );
  const getMeta = db.prepare(`SELECT value FROM meta WHERE key = ?`);
  const setMeta = db.prepare(
    `INSERT INTO meta (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );

  function rowToObj(r) {
    if (!r) return null;
    return {
      name: r.name,
      picks: JSON.parse(r.picks),
      duelAnswers: JSON.parse(r.duel_answers || "{}"),
      duelDone: r.duel_done === 1,
    };
  }

  return {
    raw: db,
    upsert(name, picks) {
      upsertStmt.run({ name: name.trim(), picks: JSON.stringify(picks), updated_at: Date.now() });
    },
    all() {
      return allStmt.all().map(rowToObj);
    },
    getByName(name) {
      return rowToObj(byNameStmt.get(name.trim()));
    },
    saveDuelAnswer(name, clashId, choice) {
      const row = byNameStmt.get(name.trim());
      if (!row) return;
      const answers = JSON.parse(row.duel_answers || "{}");
      answers[clashId] = choice;
      answerStmt.run({ name: name.trim(), answers: JSON.stringify(answers) });
    },
    submitDuel(name) {
      doneStmt.run({ name: name.trim() });
    },
    getPhase() {
      const r = getMeta.get("phase");
      return r ? r.value : "picking";
    },
    setPhase(phase) {
      setMeta.run({ key: "phase", value: phase });
    },
  };
}

module.exports = { createDb };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/db.test.js`
Expected: PASS (all three).

- [ ] **Step 5: Verify existing tests still pass**

Run: `node --test`
Expected: PASS — existing `test/api.test.js` unaffected (`all()` still returns `name`/`picks`).

- [ ] **Step 6: Commit**

```bash
git add db.js test/db.test.js
git commit -m "feat: persist app phase and per-person duel answers"
```

---

### Task 3: Phase endpoints + submit freeze

**Files:**
- Modify: `server.js`
- Test: `test/api.test.js` (append)

**Interfaces:**
- Consumes: `db.getPhase()`, `db.setPhase()` (Task 2).
- Produces HTTP:
  - `GET /api/phase -> { phase }`.
  - `POST /api/admin/phase { token, phase } -> { ok: true, phase }`; 403 bad token, 400 bad phase value.
  - `POST /api/submit` returns 409 `{ error }` when phase is `"duel"`.
- Module-level constant `ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev"` and `PHASES = new Set(["picking", "duel"])`.

- [ ] **Step 1: Write the failing test**

```javascript
// append to test/api.test.js
test("phase defaults to picking, admin can flip, submit freezes in duel", async () => {
  const { base, close } = await boot();
  try {
    let phase = await fetch(`${base}/api/phase`).then((r) => r.json());
    assert.equal(phase.phase, "picking");

    // bad token rejected
    let res = await fetch(`${base}/api/admin/phase`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "wrong", phase: "duel" }),
    });
    assert.equal(res.status, 403);

    // bad phase value rejected
    res = await fetch(`${base}/api/admin/phase`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "dev", phase: "banana" }),
    });
    assert.equal(res.status, 400);

    // valid flip
    res = await fetch(`${base}/api/admin/phase`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "dev", phase: "duel" }),
    });
    assert.equal(res.status, 200);
    phase = await fetch(`${base}/api/phase`).then((r) => r.json());
    assert.equal(phase.phase, "duel");

    // submit now frozen
    res = await post(base, "Ary", [{ id: someId, tier: "definitely" }]);
    assert.equal(res.status, 409);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/api.test.js`
Expected: FAIL — `GET /api/phase` 404 / `phase` undefined.

- [ ] **Step 3: Write minimal implementation**

In `server.js`, add near the top constants (after `const TIERS`):

```javascript
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "dev";
const PHASES = new Set(["picking", "duel"]);
```

Inside `createApp`, add the phase routes (place before `/api/submit`):

```javascript
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
```

In the existing `/api/submit` handler, add this guard as the first line inside the handler (before reading `body`):

```javascript
    if (db.getPhase() !== "picking") {
      return res.status(409).json({ error: "picking is closed" });
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/api.test.js`
Expected: PASS — new test green; existing submit tests still pass (default phase is `picking`).

- [ ] **Step 5: Commit**

```bash
git add server.js test/api.test.js
git commit -m "feat: app phase endpoints and freeze picking in duel phase"
```

---

### Task 4: Duel endpoints (fetch/answer/submit/results) + /plan route

**Files:**
- Modify: `server.js`
- Test: `test/api.test.js` (append)

**Interfaces:**
- Consumes: `computeClashes` (Task 1); `db.all()`, `db.getByName()`, `db.saveDuelAnswer()`, `db.submitDuel()`, `db.getPhase()` (Task 2); `schedule.ARTISTS`.
- Produces HTTP:
  - `GET /api/duel?name= -> { phase, done, myAnswers, clashes }`. `clashes` is `[]` unless phase is `duel`. Each clash option gains `count` and `voters: [names]`. `done`/`myAnswers` come from the named person (defaults `false`/`{}`).
  - `POST /api/duel/answer { name, clashId, choice } -> { ok: true }`; 409 if not duel phase; 400 unknown clashId or invalid choice; 403 if the name has no submission.
  - `POST /api/duel/submit { name } -> { ok: true }`; 409 if not duel phase.
  - `GET /api/duel/results -> { totalDone, clashes: [{ id, day, options, tally, chosenBy, winner }] }`.
  - `GET /plan` serves `public/plan.html`.
- Internal helper `buildClashes(db)` returning `{ counts, voters, clashes }` reused by the duel fetch and results.

- [ ] **Step 1: Write the failing test**

```javascript
// append to test/api.test.js
// helper: put two overlapping fri shows into the schedule's real ids.
const scheduleMod = require("../data/schedule");
function firstOverlappingPair() {
  const fri = scheduleMod.ARTISTS.filter((a) => a.day === "fri");
  for (let i = 0; i < fri.length; i++)
    for (let j = i + 1; j < fri.length; j++)
      if (fri[i].stage !== fri[j].stage &&
          fri[i].rowStart < fri[j].rowEnd && fri[j].rowStart < fri[i].rowEnd)
        return [fri[i], fri[j]];
  throw new Error("no overlapping pair in schedule");
}

test("duel flow: clashes surface, answers save case-insensitively, submit sets done", async () => {
  const { base, close } = await boot();
  const flip = (phase) => fetch(`${base}/api/admin/phase`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "dev", phase }),
  });
  try {
    const [a, b] = firstOverlappingPair();
    // Two people vote for the two overlapping shows (picking phase).
    await post(base, "Ary", [{ id: a.id, tier: "definitely" }]);
    await post(base, "Sam", [{ id: b.id, tier: "definitely" }]);

    // No clashes while picking.
    let duel = await fetch(`${base}/api/duel?name=Ary`).then((r) => r.json());
    assert.deepEqual(duel.clashes, []);

    await flip("duel");
    duel = await fetch(`${base}/api/duel?name=Ary`).then((r) => r.json());
    assert.ok(duel.clashes.length >= 1, "clash surfaces in duel phase");
    const clash = duel.clashes.find((c) => c.options.some((o) => o.id === a.id));
    assert.ok(clash, "our pair forms a clash");
    const opt = clash.options.find((o) => o.id === a.id);
    assert.equal(opt.count, 1);
    assert.deepEqual(opt.voters, ["Ary"]);

    // Unknown clash / invalid choice rejected.
    let res = await fetch(`${base}/api/duel/answer`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ary", clashId: "nope", choice: a.id }),
    });
    assert.equal(res.status, 400);
    res = await fetch(`${base}/api/duel/answer`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ary", clashId: clash.id, choice: "not-an-option" }),
    });
    assert.equal(res.status, 400);

    // Person with no submission cannot answer.
    res = await fetch(`${base}/api/duel/answer`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ghost", clashId: clash.id, choice: a.id }),
    });
    assert.equal(res.status, 403);

    // Valid answer, saved case-insensitively.
    res = await fetch(`${base}/api/duel/answer`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ary", clashId: clash.id, choice: a.id }),
    });
    assert.equal(res.status, 200);
    duel = await fetch(`${base}/api/duel?name=Ary`).then((r) => r.json());
    assert.equal(duel.myAnswers[clash.id], a.id);
    assert.equal(duel.done, false);

    // Sam answers "none"; submit both.
    await fetch(`${base}/api/duel/answer`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sam", clashId: clash.id, choice: "none" }),
    });
    await fetch(`${base}/api/duel/submit`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ary" }),
    });
    duel = await fetch(`${base}/api/duel?name=Ary`).then((r) => r.json());
    assert.equal(duel.done, true);

    // Results tally: A has 1 real vote, none excluded from winning.
    const results = await fetch(`${base}/api/duel/results`).then((r) => r.json());
    const rc = results.clashes.find((c) => c.id === clash.id);
    assert.equal(rc.tally[a.id], 1);
    assert.equal(rc.tally["none"], 1);
    assert.equal(rc.winner, a.id);
    assert.deepEqual(rc.chosenBy[a.id], ["Ary"]);
  } finally {
    await close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/api.test.js`
Expected: FAIL — `/api/duel` 404.

- [ ] **Step 3: Write minimal implementation**

In `server.js`, add the import near the top:

```javascript
const { computeClashes } = require("./data/clashes");
```

Inside `createApp`, add a shared builder and the routes (place after the phase routes):

```javascript
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
```

Note: `c.options` is already ordered by `rowStart` (Task 1), so the winner tie-break "earliest first wins the `>` comparison" holds.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test`
Expected: PASS — all suites (clashes, db, api).

- [ ] **Step 5: Commit**

```bash
git add server.js test/api.test.js
git commit -m "feat: duel fetch/answer/submit/results endpoints and /plan route"
```

---

### Task 5: Picker phase-lock + duel modal (client)

**Files:**
- Modify: `public/index.html` (add duel modal markup + plan nav link)
- Modify: `public/app.js` (phase-aware init, duel modal controller)
- Modify: `public/styles.css` (duel modal + option-card styles)

**Interfaces:**
- Consumes: `GET /api/phase`, `GET /api/duel?name=`, `POST /api/duel/answer`, `POST /api/duel/submit`.
- Produces: no code interface (browser UI). Verified manually.

No automated client test harness exists in this repo (no jsdom), so this task is TDD-exempt and verified by running the app; the underlying data paths are already covered by Task 4.

- [ ] **Step 1: Add duel modal markup + plan link to `public/index.html`**

Add a plan link inside `.actions` (before the Results link):

```html
        <a class="btn ghost" href="/plan">Group Plan →</a>
```

Add this modal block just before the `<div class="toast" id="toast"></div>` line:

```html
  <!-- duel quiz modal (opens in duel phase) -->
  <div class="modal-bg duel" id="duelBg">
    <div class="modal duel-modal">
      <div class="duel-head">
        <div class="duel-kicker">Resolve the clash</div>
        <div class="duel-progress" id="duelProgress"></div>
      </div>
      <div class="duel-q" id="duelQ"></div>
      <div class="duel-options" id="duelOptions"></div>
      <div class="duel-nav">
        <button class="btn ghost" id="duelBack">← Back</button>
        <button class="btn" id="duelNext">Next →</button>
        <button class="btn primary" id="duelSubmit" hidden>Submit</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Add the duel controller to `public/app.js`**

Inside the IIFE, add element refs to the `els` object:

```javascript
    duelBg: document.getElementById("duelBg"),
    duelProgress: document.getElementById("duelProgress"),
    duelQ: document.getElementById("duelQ"),
    duelOptions: document.getElementById("duelOptions"),
    duelBack: document.getElementById("duelBack"),
    duelNext: document.getElementById("duelNext"),
    duelSubmit: document.getElementById("duelSubmit"),
```

Add duel state + logic (place before `async function init()`):

```javascript
  // ---- duel quiz ----
  let duel = { clashes: [], answers: {}, i: 0, done: false };

  function escapeHtml(s) { return ACLGrid.escapeHtml(s); }

  function renderDuel() {
    const clash = duel.clashes[duel.i];
    if (!clash) return;
    els.duelProgress.textContent = `${duel.i + 1} / ${duel.clashes.length}`;
    els.duelQ.innerHTML =
      `You picked more than one show at the same time. Where should the group go?`;
    const chosen = duel.answers[clash.id];
    const opts = clash.options.map((o) => {
      const who = o.voters.length ? escapeHtml(o.voters.join(", ")) : "no votes yet";
      return `<button class="duel-opt${chosen === o.id ? " sel" : ""}" data-choice="${o.id}">
          <span class="do-name">${escapeHtml(o.name)}</span>
          <span class="do-meta">${escapeHtml(o.timeLabel)} · ${escapeHtml(o.stage)}</span>
          <span class="do-votes">${o.count} vote${o.count === 1 ? "" : "s"} · ${who}</span>
        </button>`;
    }).join("");
    const noneSel = chosen === "none" ? " sel" : "";
    els.duelOptions.innerHTML = opts +
      `<button class="duel-opt none${noneSel}" data-choice="none">
         <span class="do-name">No preference</span>
         <span class="do-meta">Skip this one</span>
       </button>`;
    els.duelOptions.querySelectorAll(".duel-opt").forEach((b) =>
      b.addEventListener("click", () => chooseDuel(clash.id, b.dataset.choice)));
    els.duelBack.disabled = duel.i === 0;
    const answeredAll = duel.clashes.every((c) => duel.answers[c.id] != null);
    const isLast = duel.i === duel.clashes.length - 1;
    els.duelNext.hidden = isLast;
    els.duelSubmit.hidden = !isLast;
    els.duelSubmit.disabled = !answeredAll;
  }

  async function chooseDuel(clashId, choice) {
    duel.answers[clashId] = choice;
    renderDuel();
    try {
      await fetch("/api/duel/answer", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, clashId, choice }),
      });
    } catch (e) {}
    if (duel.i < duel.clashes.length - 1) { duel.i++; renderDuel(); }
  }

  async function submitDuel() {
    els.duelSubmit.disabled = true;
    try {
      await fetch("/api/duel/submit", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      duel.done = true;
      els.duelBg.classList.remove("show");
      toast("Locked in! See the group plan.");
      setTimeout(() => (window.location.href = "/plan"), 900);
    } catch (e) {
      els.duelSubmit.disabled = false;
      toast("Error saving — try again");
    }
  }

  async function maybeOpenDuel() {
    if (!name) return;
    let data;
    try { data = await fetch("/api/duel?name=" + encodeURIComponent(name)).then((r) => r.json()); }
    catch (e) { return; }
    if (data.phase !== "duel" || data.done || !data.clashes.length) return;
    duel = { clashes: data.clashes, answers: data.myAnswers || {}, i: 0, done: false };
    // resume at first unanswered clash
    const firstUnanswered = duel.clashes.findIndex((c) => duel.answers[c.id] == null);
    duel.i = firstUnanswered === -1 ? 0 : firstUnanswered;
    renderDuel();
    els.duelBg.classList.add("show");
  }
```

Wire the nav buttons and phase-lock in `init()`. After the existing `els.editBtn.addEventListener(...)` line add:

```javascript
    els.duelBack.addEventListener("click", () => { if (duel.i > 0) { duel.i--; renderDuel(); } });
    els.duelNext.addEventListener("click", () => { if (duel.i < duel.clashes.length - 1) { duel.i++; renderDuel(); } });
    els.duelSubmit.addEventListener("click", submitDuel);
```

At the end of `init()`, after `applyLockUI();`, add the phase check:

```javascript
    try {
      const { phase } = await fetch("/api/phase").then((r) => r.json());
      if (phase === "duel") {
        locked = true;               // freeze the picker (reuse lock UI)
        applyLockUI();
        els.submitBtn.hidden = true;
        els.editBtn.hidden = true;
        els.hint.innerHTML = "Picking is closed. Resolve the clashes below.";
        await maybeOpenDuel();
      }
    } catch (e) {}
```

- [ ] **Step 3: Add duel styles to `public/styles.css`**

Append (reuse existing color tokens/fonts already in the file — match the `.modal`/`.btn` look):

```css
/* ---- duel quiz modal ---- */
.duel-modal { max-width: 520px; width: 92vw; }
.duel-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
.duel-kicker { font-family: "Anton", sans-serif; letter-spacing: .04em; text-transform: uppercase; }
.duel-progress { font-weight: 700; opacity: .7; }
.duel-q { margin: 4px 0 14px; font-weight: 700; }
.duel-options { display: grid; gap: 10px; }
.duel-opt {
  display: grid; text-align: left; gap: 2px; padding: 12px 14px;
  border: 2px solid rgba(0,0,0,.15); border-radius: 12px; background: #fff; cursor: pointer;
}
.duel-opt.sel { border-color: #ff2e9a; background: #fff0f7; }
.duel-opt.none { opacity: .8; }
.do-name { font-family: "Anton", sans-serif; font-size: 1.1rem; }
.do-meta { font-size: .82rem; opacity: .7; }
.do-votes { font-size: .82rem; font-weight: 700; color: #d81b78; }
.duel-nav { display: flex; gap: 10px; justify-content: space-between; margin-top: 16px; }
```

- [ ] **Step 4: Manual verification**

```bash
rm -f data/picks.db data/picks.db-shm data/picks.db-wal   # clean local db
npm run dev
```

Then, in a browser at http://localhost:3000:
1. Enter a name, pick two shows that overlap in time on the same day, Submit.
2. Open an incognito window, enter a second name, pick the other overlapping show, Submit.
3. Flip to duel phase:
   ```bash
   curl -s -X POST localhost:3000/api/admin/phase -H 'content-type: application/json' -d '{"token":"dev","phase":"duel"}'
   ```
4. Reload the first browser: picker is read-only and the duel modal opens; clicking outside does NOT close it. Choose an option → it advances; Back returns with the choice highlighted.
5. Refresh mid-quiz → modal reopens resumed at the first unanswered clash with prior answers intact.
6. Answer all, Submit → modal closes, redirects to `/plan`. Reload the picker → modal does NOT reappear.
7. Reset to picking for cleanup:
   ```bash
   curl -s -X POST localhost:3000/api/admin/phase -H 'content-type: application/json' -d '{"token":"dev","phase":"picking"}'
   ```

Confirm each numbered behavior before committing.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/app.js public/styles.css
git commit -m "feat: duel quiz modal and picker phase-lock on the picker page"
```

---

### Task 6: Group-plan view (`/plan`)

**Files:**
- Create: `public/plan.html`
- Create: `public/plan.js`
- Modify: `public/results.html` (add plan nav link)

**Interfaces:**
- Consumes: `GET /api/duel/results`, `GET /api/phase`.
- Produces: browser UI. Verified manually.

- [ ] **Step 1: Create `public/plan.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>ACL Group Plan</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="wrap">
    <header class="mast">
      <div class="kicker">ACL Schedule Planner</div>
      <h1>The Group Plan</h1>
      <div class="sub">Where we landed on the clashes</div>
    </header>
    <div class="toolbar">
      <div class="days"></div>
      <div class="actions">
        <a class="btn ghost" href="/results">Results →</a>
        <a class="btn primary" href="/">← Picker</a>
      </div>
    </div>
    <div class="count-strip" id="planStrip">Loading…</div>
    <div id="planList" class="plan-list"></div>
  </div>
  <script src="/grid.js"></script>
  <script src="/plan.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `public/plan.js`**

```javascript
// Group-plan view: winning show per clash, vote split, who chose what.
(function () {
  const POLL_MS = 3000;
  const esc = ACLGrid.escapeHtml;
  const els = {
    strip: document.getElementById("planStrip"),
    list: document.getElementById("planList"),
  };

  function optName(clash, id) {
    if (id === "none") return "No preference";
    const o = clash.options.find((x) => x.id === id);
    return o ? o.name : id;
  }

  function card(clash) {
    const rows = clash.options.map((o) => {
      const n = clash.tally[o.id] || 0;
      const who = (clash.chosenBy[o.id] || []).map(esc).join(", ");
      const win = clash.winner === o.id ? " win" : "";
      return `<div class="plan-opt${win}">
          <div class="po-top"><span class="po-name">${esc(o.name)}</span>
            <span class="po-count">${n}</span></div>
          <div class="po-meta">${esc(o.timeLabel)} · ${esc(o.stage)}${clash.winner === o.id ? " · 👑 group pick" : ""}</div>
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
    if (!data.clashes.length) {
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
```

- [ ] **Step 3: Append plan-card styles to `public/styles.css`**

```css
/* ---- group plan ---- */
.plan-list { display: grid; gap: 16px; margin-top: 12px; }
.plan-card { border: 2px solid rgba(0,0,0,.12); border-radius: 14px; padding: 14px; background: #fff; }
.plan-day { font-family: "Anton", sans-serif; letter-spacing: .06em; opacity: .6; margin-bottom: 8px; }
.plan-opt { padding: 10px 12px; border-radius: 10px; background: #faf7f2; margin-bottom: 8px; }
.plan-opt.win { background: #fff0f7; border: 2px solid #ff2e9a; }
.plan-opt.none { opacity: .75; }
.po-top { display: flex; justify-content: space-between; align-items: baseline; }
.po-name { font-family: "Anton", sans-serif; font-size: 1.1rem; }
.po-count { font-weight: 800; color: #d81b78; }
.po-meta { font-size: .82rem; opacity: .7; }
.po-who { font-size: .82rem; margin-top: 2px; }
```

- [ ] **Step 4: Add a plan link to `public/results.html`**

In the `.actions` div, before the existing Picker link, add:

```html
        <a class="btn ghost" href="/plan">Group Plan →</a>
```

- [ ] **Step 5: Manual verification**

With the duel data from Task 5 still present (or re-run its steps), visit http://localhost:3000/plan:
- Each clash renders a card; the winning option shows the 👑 group-pick marker and pink highlight.
- Vote counts and who-chose-what match the answers given.
- The "No preference" row appears only when someone chose it.
- With no clashes, the strip reads "No clashes to resolve yet."

- [ ] **Step 6: Commit**

```bash
git add public/plan.html public/plan.js public/styles.css public/results.html
git commit -m "feat: group-plan view showing the winning show per clash"
```

---

### Task 7: Admin control page

**Files:**
- Create: `public/admin.html`

**Interfaces:**
- Consumes: `GET /api/phase`, `POST /api/admin/phase`.
- Produces: browser UI. Verified manually.

- [ ] **Step 1: Create `public/admin.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>ACL Admin</title>
  <link href="https://fonts.googleapis.com/css2?family=Anton&family=Archivo:wght@600;700;800&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="wrap">
    <header class="mast"><div class="kicker">Host only</div><h1>Phase Control</h1></header>
    <div class="count-strip">Current phase: <b id="phaseNow">…</b></div>
    <div class="modal" style="max-width:420px;margin-top:16px">
      <p>Enter the admin token, then open or close picking.</p>
      <input id="tok" placeholder="admin token" autocomplete="off" />
      <div class="actions" style="margin-top:12px;display:flex;gap:10px">
        <button class="btn" id="openBtn">Open picking</button>
        <button class="btn primary" id="closeBtn">Close → duel</button>
      </div>
      <div class="hint" id="msg" style="margin-top:10px"></div>
    </div>
  </div>
  <script>
    const TKEY = "acl_admin_token";
    const $ = (id) => document.getElementById(id);
    $("tok").value = localStorage.getItem(TKEY) || "";
    async function showPhase() {
      const { phase } = await fetch("/api/phase").then((r) => r.json());
      $("phaseNow").textContent = phase;
    }
    async function setPhase(phase) {
      const token = $("tok").value.trim();
      localStorage.setItem(TKEY, token);
      const res = await fetch("/api/admin/phase", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, phase }),
      });
      $("msg").textContent = res.ok ? `Phase set to ${phase}.` : `Failed (${res.status}) — check token.`;
      showPhase();
    }
    $("openBtn").addEventListener("click", () => setPhase("picking"));
    $("closeBtn").addEventListener("click", () => setPhase("duel"));
    showPhase();
  </script>
</body>
</html>
```

- [ ] **Step 2: Manual verification**

Visit http://localhost:3000/admin: current phase shows; a wrong token shows a failure message; the correct token (`dev` locally) flips the phase, reflected in "Current phase". Confirm the picker reacts on reload.

- [ ] **Step 3: Commit**

```bash
git add public/admin.html
git commit -m "feat: minimal admin page to open/close picking"
```

---

### Task 8: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Document the duel phase and admin flip**

Add a section to `README.md` after the intro bullets:

```markdown
## Duel mode (resolve time clashes)

When two shows people voted for overlap in time, the group decides where to go
together via a one-at-a-time quiz:

1. Host closes picking at `/admin` (enter the admin token). Set `ADMIN_TOKEN` in
   the environment; it defaults to `dev` locally. Closing picking freezes votes.
2. Each friend, on their next visit, gets a blocking modal walking them through
   every clash — pick one show per clash (or "No preference"). Progress saves as
   they go and resumes if they leave; hitting **Submit** finalizes and they won't
   see it again.
3. **`/plan`** shows the group plan: the winning show per clash, the vote split,
   and who chose what. Reopen picking anytime from `/admin`.
```

- [ ] **Step 2: Verify full test suite still green**

Run: `node --test`
Expected: PASS — all suites.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document duel mode and admin phase flip"
```

---

## Self-Review

**Spec coverage:**
- Phases + `meta` table → Task 2, 3. ✓
- Manual admin flip + `ADMIN_TOKEN` + `/admin` → Task 3 (endpoint), Task 7 (page). ✓
- Clash detection (union-find, ≥2, stable id, chaining note) → Task 1. ✓
- Data model duel columns + migration → Task 2. ✓
- All endpoints (`phase`, `admin/phase`, `duel`, `duel/answer`, `duel/submit`, `duel/results`, `/plan`) + submit 409 guard → Task 3, 4. ✓
- Picker phase-lock + blocking, resumable, partial-save modal with No-preference + Back/Next/Submit → Task 5. ✓
- Group-plan `/plan` view → Task 6. ✓
- Nav links → Task 5 (index), 6 (results). ✓
- Tests matching existing style → Task 1, 2, 3, 4. ✓
- README → Task 8. ✓

**Placeholder scan:** No TBD/TODO; all code steps carry concrete code. ✓

**Type consistency:** `computeClashes(artists, counts)` shape used identically in Task 1 and Task 4; `getByName` returns `{name, picks, duelAnswers, duelDone}` used consistently in Task 4; `choice` sentinel `"none"` consistent across Tasks 4/5/6; clash `id` format identical in Task 1 and asserted in Task 4. ✓

**Review Focus coverage:** case-insensitive name (Task 2 + Task 4 tests), invalid clashId/choice 400 (Task 4 test), submit 409 freeze (Task 3 test), no-submission answer 403 (Task 4 test), no-clash empty state (Task 4 asserts `[]` in picking; Task 5/6 handle empty UI). ✓
