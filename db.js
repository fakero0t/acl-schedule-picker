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
