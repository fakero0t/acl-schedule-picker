const test = require("node:test");
const assert = require("node:assert");
const { createApp, createDb } = require("../server");
const geo = require("../public/geo");

async function boot() {
  const db = createDb(":memory:");
  const app = createApp(db);
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, db, close: () => new Promise((r) => server.close(r)) };
}

const postLoc = (base, body) =>
  fetch(`${base}/api/location`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("GPS location is stored and returned; re-posting updates the same row", async () => {
  const { base, close } = await boot();
  try {
    assert.equal((await postLoc(base, { name: "Ary", lat: 30.2675, lon: -97.767, accuracy: 8 })).status, 200);
    await postLoc(base, { name: "ary", lat: 30.268, lon: -97.766, accuracy: 5 });
    const res = await fetch(`${base}/api/locations`).then((r) => r.json());
    assert.equal(res.people.length, 1, "same name (any case) must not duplicate");
    assert.equal(res.people[0].lat, 30.268);
    assert.equal(res.people[0].x, null);
  } finally {
    await close();
  }
});

test("manual pin is stored as map coordinates and replaces a GPS fix", async () => {
  const { base, close } = await boot();
  try {
    await postLoc(base, { name: "Lee", lat: 30.2675, lon: -97.767, accuracy: 8 });
    await postLoc(base, { name: "Lee", x: 900, y: 600 });
    const res = await fetch(`${base}/api/locations`).then((r) => r.json());
    assert.equal(res.people.length, 1);
    assert.equal(res.people[0].x, 900);
    assert.equal(res.people[0].y, 600);
    assert.equal(res.people[0].lat, null, "old GPS fix is cleared");
  } finally {
    await close();
  }
});

test("bad location payloads are rejected", async () => {
  const { base, close } = await boot();
  try {
    assert.equal((await postLoc(base, { name: "", lat: 30.2, lon: -97.7 })).status, 400);
    assert.equal((await postLoc(base, { name: "Ary" })).status, 400);
    assert.equal((await postLoc(base, { name: "Ary", lat: "30", lon: -97.7 })).status, 400);
    assert.equal((await postLoc(base, { name: "Ary", x: -5, y: 100 })).status, 400);
    assert.equal((await postLoc(base, { name: "Ary", x: 100, y: geo.MAP_H + 1 })).status, 400);
  } finally {
    await close();
  }
});

test("stop sharing deletes the row; stale rows are purged", async () => {
  const { base, db, close } = await boot();
  try {
    await postLoc(base, { name: "Ary", lat: 30.2675, lon: -97.767, accuracy: 8 });
    await postLoc(base, { name: "Sam", lat: 30.2675, lon: -97.767, accuracy: 8 });
    await fetch(`${base}/api/location?name=ary`, { method: "DELETE" });
    db.raw.prepare("UPDATE locations SET updated_at = ? WHERE name = 'Sam'").run(Date.now() - 31 * 60 * 1000);
    const res = await fetch(`${base}/api/locations`).then((r) => r.json());
    assert.deepEqual(res.people, []);
    assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM locations").get().n, 0, "stale rows are deleted, not just hidden");
  } finally {
    await close();
  }
});

test("geo: projection is to scale and north-up", () => {
  // 100 m east and 100 m north of the lawn center.
  const lat = 30.2675, lon = -97.767;
  const a = geo.toPixel(lat, lon);
  const east = geo.toPixel(lat, lon + 100 / (111320 * Math.cos((lat * Math.PI) / 180)));
  const north = geo.toPixel(lat + 100 / 111320, lon);
  assert.ok(Math.abs((east.x - a.x) * geo.M_PER_PX - 100) < 1, `east ${east.x - a.x}px`);
  assert.ok(Math.abs(east.y - a.y) < 0.5);
  assert.ok(Math.abs((a.y - north.y) * geo.M_PER_PX - 100) < 1, `north ${a.y - north.y}px`);
});

test("geo: near-place labels and off-site detection", () => {
  const titos = geo.PLACES.find((p) => p.name === "Tito's");
  const t = geo.toPixel(titos.lat + 0.0001, titos.lon);
  assert.equal(geo.nearestPlace(t.x, t.y).name, "Tito's");
  // Every named place sits on the map.
  for (const p of geo.PLACES) assert.ok(p.x > 0 && p.x < geo.MAP_W && p.y > 0 && p.y < geo.MAP_H, p.name);
  // Downtown Austin is not at the festival.
  const dt = geo.toPixel(30.2672, -97.7431);
  assert.equal(geo.nearestPlace(dt.x, dt.y), null);
});

const postMeet = (base, body) =>
  fetch(`${base}/api/meetup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

test("meeting point: anyone sets/moves it, everyone sees it, anyone removes it", async () => {
  const { base, close } = await boot();
  try {
    let res = await fetch(`${base}/api/locations`).then((r) => r.json());
    assert.equal(res.meetup, null);

    assert.equal((await postMeet(base, { name: "Ary", x: 900, y: 700 })).status, 200);
    await postMeet(base, { name: "Sam", x: 1200, y: 400 }); // moves it, only one exists
    res = await fetch(`${base}/api/locations`).then((r) => r.json());
    assert.equal(res.meetup.x, 1200);
    assert.equal(res.meetup.setBy, "Sam");

    await fetch(`${base}/api/meetup`, { method: "DELETE" });
    res = await fetch(`${base}/api/locations`).then((r) => r.json());
    assert.equal(res.meetup, null);
  } finally {
    await close();
  }
});

test("meeting point: bad payloads rejected, stale one expires", async () => {
  const { base, db, close } = await boot();
  try {
    assert.equal((await postMeet(base, { name: "", x: 10, y: 10 })).status, 400);
    assert.equal((await postMeet(base, { name: "Ary", x: -1, y: 10 })).status, 400);
    assert.equal((await postMeet(base, { name: "Ary", x: "10", y: 10 })).status, 400);
    await postMeet(base, { name: "Ary", x: 10, y: 10 });
    db.raw.prepare("UPDATE meetup SET updated_at = ?").run(Date.now() - 13 * 60 * 60 * 1000);
    const res = await fetch(`${base}/api/locations`).then((r) => r.json());
    assert.equal(res.meetup, null);
  } finally {
    await close();
  }
});
