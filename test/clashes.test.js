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

test("staggered chain splits into overlapping pairs (maximal cliques)", () => {
  // A(1-5) & B(3-8) overlap; B(3-8) & C(6-10) overlap; A & C do NOT overlap.
  const arts = [
    { id: "fri-a", day: "fri", stage: "a", name: "A", timeLabel: "", rowStart: 1, rowEnd: 5 },
    { id: "fri-b", day: "fri", stage: "b", name: "B", timeLabel: "", rowStart: 3, rowEnd: 8 },
    { id: "fri-c", day: "fri", stage: "c", name: "C", timeLabel: "", rowStart: 6, rowEnd: 10 },
  ];
  const counts = { "fri-a": { total: 1 }, "fri-b": { total: 1 }, "fri-c": { total: 1 } };
  const sets = computeClashes(arts, counts)
    .map((c) => c.options.map((o) => o.id).sort().join("+"))
    .sort();
  // Two duels; B bridges both; A and C are never lumped together.
  assert.deepEqual(sets, ["fri-a+fri-b", "fri-b+fri-c"]);
});

test("mutually overlapping trio stays one clique", () => {
  // All three share the window 6-7 -> a single 3-way conflict.
  const arts = [
    { id: "fri-a", day: "fri", stage: "a", name: "A", timeLabel: "", rowStart: 1, rowEnd: 7 },
    { id: "fri-b", day: "fri", stage: "b", name: "B", timeLabel: "", rowStart: 4, rowEnd: 9 },
    { id: "fri-c", day: "fri", stage: "c", name: "C", timeLabel: "", rowStart: 6, rowEnd: 10 },
  ];
  const counts = { "fri-a": { total: 1 }, "fri-b": { total: 1 }, "fri-c": { total: 1 } };
  const clashes = computeClashes(arts, counts);
  assert.equal(clashes.length, 1);
  assert.deepEqual(clashes[0].options.map((o) => o.id), ["fri-a", "fri-b", "fri-c"]);
});
