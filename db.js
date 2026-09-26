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

  const upsertStmt = db.prepare(`
    INSERT INTO submissions (name, picks, updated_at)
    VALUES (@name, @picks, @updated_at)
    ON CONFLICT(name) DO UPDATE SET
      picks = excluded.picks,
      updated_at = excluded.updated_at
  `);
  const allStmt = db.prepare(`SELECT name, picks FROM submissions ORDER BY name COLLATE NOCASE`);

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
    // Insert or overwrite one person's picks. name is stored trimmed.
    upsert(name, picks) {
      upsertStmt.run({
        name: name.trim(),
        picks: JSON.stringify(picks),
        updated_at: Date.now(),
      });
    },
    // -> [{ name, picks: [artistId, ...] }]
    all() {
      return allStmt.all().map((r) => ({
        name: r.name,
        picks: JSON.parse(r.picks),
      }));
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
