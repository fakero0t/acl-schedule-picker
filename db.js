// SQLite persistence. One row per person, keyed by name; picks stored as JSON.
const Database = require("better-sqlite3");

function createDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  const hadEvents = !!db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'events'`)
    .get();
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
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      day         TEXT NOT NULL,
      start       TEXT NOT NULL,
      end         TEXT,
      name        TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      location    TEXT NOT NULL DEFAULT '',
      kind        TEXT NOT NULL DEFAULT 'event',
      updated_at  INTEGER NOT NULL
    );
  `);
  // kind: "event" (outside event) | "hangout" (pregame / other). Added after the table.
  if (!db.prepare(`SELECT 1 FROM pragma_table_info('events') WHERE name = 'kind'`).get()) {
    db.exec(`ALTER TABLE events ADD COLUMN kind TEXT NOT NULL DEFAULT 'event'`);
  }

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

  const EVENT_COLS = `id, day, start, end, name, description, location, kind`;
  const insertEventStmt = db.prepare(`
    INSERT INTO events (day, start, end, name, description, location, kind, updated_at)
    VALUES (@day, @start, @end, @name, @description, @location, @kind, @updated_at)
  `);
  const updateEventStmt = db.prepare(`
    UPDATE events SET day = @day, start = @start, end = @end, name = @name,
      description = @description, location = @location, kind = @kind, updated_at = @updated_at
    WHERE id = @id
  `);
  const getEventStmt = db.prepare(`SELECT ${EVENT_COLS} FROM events WHERE id = ?`);
  const allEventsStmt = db.prepare(`SELECT ${EVENT_COLS} FROM events ORDER BY day, start, id`);
  const deleteEventStmt = db.prepare(`DELETE FROM events WHERE id = ?`);

  // Seed the first group plans once, when the events table is first created
  // (so deleting them later doesn't bring them back).
  if (!hadEvents) {
    insertEventStmt.run({
      day: "sat",
      start: "10:00",
      end: "13:00",
      name: "Coffee & Chill: Hayden James",
      description: "Coffee, community, cold plunge + a Hayden James set. RSVP: https://coffeeandchill.com/products/austin-oct-3",
      location: "Republic Square Park",
      kind: "event",
      updated_at: Date.now(),
    });
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
    // Weekend plans (non-ACL events): {id, day, start, end|null, name, description, location, kind}
    events() {
      return allEventsStmt.all();
    },
    addEvent(ev) {
      const { lastInsertRowid } = insertEventStmt.run({ ...ev, updated_at: Date.now() });
      return getEventStmt.get(lastInsertRowid);
    },
    // -> updated event, or undefined if no such id
    updateEvent(id, ev) {
      const { changes } = updateEventStmt.run({ ...ev, id, updated_at: Date.now() });
      return changes ? getEventStmt.get(id) : undefined;
    },
    deleteEvent(id) {
      return deleteEventStmt.run(id).changes > 0;
    },
  };
}

module.exports = { createDb };
