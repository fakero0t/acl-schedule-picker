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
