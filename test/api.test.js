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
