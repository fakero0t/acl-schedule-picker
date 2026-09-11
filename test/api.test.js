const test = require("node:test");
const assert = require("node:assert");
const { createApp, createDb } = require("../server");
const schedule = require("../data/schedule");

// Spin up the app on an ephemeral port with an in-memory db, return base url + close().
async function boot() {
  const db = createDb(":memory:");
  const app = createApp(db);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => server.close(r)) };
}

const someId = schedule.ARTISTS[0].id;
const anotherId = schedule.ARTISTS[5].id;

test("schedule data is well-formed and ids are unique", () => {
  assert.ok(schedule.ARTISTS.length > 40, "expected the full weekend lineup");
  const ids = schedule.ARTISTS.map((a) => a.id);
  assert.equal(ids.length, new Set(ids).size, "artist ids must be unique");
  for (const a of schedule.ARTISTS) {
    assert.ok(a.rowEnd > a.rowStart, `${a.name} must span at least one row`);
    assert.ok(["fri", "sat", "sun"].includes(a.day));
  }
});

test("submit stores picks and results aggregates counts", async () => {
  const { base, close } = await boot();
  try {
    await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ary", picks: [someId, anotherId] }),
    });
    await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Sam", picks: [someId] }),
    });

    const res = await fetch(`${base}/api/results`).then((r) => r.json());
    assert.equal(res.totalPeople, 2);
    assert.equal(res.counts[someId], 2);
    assert.equal(res.counts[anotherId], 1);
    assert.deepEqual(res.voters[someId].sort(), ["Ary", "Sam"]);
  } finally {
    await close();
  }
});

test("re-submitting the same name overwrites (upsert), never duplicates", async () => {
  const { base, close } = await boot();
  try {
    const post = (picks) =>
      fetch(`${base}/api/submit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Ary", picks }),
      });
    await post([someId, anotherId]);
    await post([anotherId]); // edited: dropped someId

    const res = await fetch(`${base}/api/results`).then((r) => r.json());
    assert.equal(res.totalPeople, 1, "same name must not create a second row");
    assert.equal(res.counts[someId], undefined);
    assert.equal(res.counts[anotherId], 1);
  } finally {
    await close();
  }
});

test("unknown artist ids are rejected", async () => {
  const { base, close } = await boot();
  try {
    const r = await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ary", picks: ["not-a-real-id"] }),
    });
    assert.equal(r.status, 400);
  } finally {
    await close();
  }
});

test("missing name is rejected", async () => {
  const { base, close } = await boot();
  try {
    const r = await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "  ", picks: [someId] }),
    });
    assert.equal(r.status, 400);
  } finally {
    await close();
  }
});

test("/api/me returns saved picks for a returning person", async () => {
  const { base, close } = await boot();
  try {
    await fetch(`${base}/api/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Ary", picks: [someId] }),
    });
    const me = await fetch(`${base}/api/me?name=ary`).then((r) => r.json());
    assert.deepEqual(me.picks, [someId]);
  } finally {
    await close();
  }
});
