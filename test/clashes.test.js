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
