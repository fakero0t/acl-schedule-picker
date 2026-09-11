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
  `);

  const upsertStmt = db.prepare(`
    INSERT INTO submissions (name, picks, updated_at)
    VALUES (@name, @picks, @updated_at)
    ON CONFLICT(name) DO UPDATE SET
      picks = excluded.picks,
      updated_at = excluded.updated_at
  `);
  const allStmt = db.prepare(`SELECT name, picks FROM submissions ORDER BY name COLLATE NOCASE`);

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
  };
}

module.exports = { createDb };
