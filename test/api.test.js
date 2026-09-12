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

const post = (base, name, picks) =>
  fetch(`${base}/api/submit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, picks }),
  });

test("submit stores tiered picks and results aggregates by tier", async () => {
  const { base, close } = await boot();
  try {
    await post(base, "Ary", [{ id: someId, tier: "definitely" }, { id: anotherId, tier: "maybe" }]);
    await post(base, "Sam", [{ id: someId, tier: "maybe" }]);

    const res = await fetch(`${base}/api/results`).then((r) => r.json());
    assert.equal(res.totalPeople, 2);
    assert.equal(res.counts[someId].definitely, 1);
    assert.equal(res.counts[someId].maybe, 1);
    assert.equal(res.counts[someId].total, 2);
    assert.equal(res.counts[someId].weighted, 1.5); // 1 + 0.5
    assert.equal(res.counts[anotherId].maybe, 1);
    assert.deepEqual(res.voters[someId].definitely, ["Ary"]);
    assert.deepEqual(res.voters[someId].maybe.sort(), ["Sam"]);
  } finally {
    await close();
  }
});

test("bare string ids are accepted and treated as definitely (back-compat)", async () => {
  const { base, close } = await boot();
  try {
    await post(base, "Ary", [someId]);
    const res = await fetch(`${base}/api/results`).then((r) => r.json());
    assert.equal(res.counts[someId].definitely, 1);
    assert.equal(res.counts[someId].maybe, 0);
    const me = await fetch(`${base}/api/me?name=ary`).then((r) => r.json());
    assert.deepEqual(me.picks, [{ id: someId, tier: "definitely" }]);
  } finally {
    await close();
  }
});

test("invalid tier is rejected", async () => {
  const { base, close } = await boot();
  try {
    const r = await post(base, "Ary", [{ id: someId, tier: "sorta" }]);
    assert.equal(r.status, 400);
  } finally {
    await close();
  }
});

test("re-submitting the same name overwrites (upsert), never duplicates", async () => {
  const { base, close } = await boot();
  try {
    await post(base, "Ary", [someId, anotherId]);
    await post(base, "Ary", [anotherId]); // edited: dropped someId

    const res = await fetch(`${base}/api/results`).then((r) => r.json());
    assert.equal(res.totalPeople, 1, "same name must not create a second row");
    assert.equal(res.counts[someId], undefined);
    assert.equal(res.counts[anotherId].total, 1);
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
    await post(base, "Ary", [{ id: someId, tier: "maybe" }]);
    const me = await fetch(`${base}/api/me?name=ary`).then((r) => r.json());
    assert.deepEqual(me.picks, [{ id: someId, tier: "maybe" }]);
  } finally {
    await close();
  }
});
