// GPS <-> festival-map pixel conversion, shared by the map page and tests.
// /festival-aerial.jpg (Esri World Imagery) and /festival-overlay.svg (OpenStreetMap)
// cover exactly these bounds, north-up and to scale, so a linear projection works.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ACLGeo = api;
})(typeof self !== "undefined" ? self : this, function () {
  // Logical map size in pixels (0.6 m per pixel) and its corner coordinates.
  const MAP_W = 1921;
  const MAP_H = 1341;
  const NORTH = 30.270532;
  const WEST = -97.772901;
  const SOUTH = 30.263304;
  const EAST = -97.760915;

  // Stages, areas and gates, placed from the official ACL 2026 festival map: stages sit on
  // the stage structures in the aerial photo (the sites don't move year to year), and
  // everything else is carried over from the official map by warping it onto those
  // stages. Not surveyed on-site, so treat as roughly ±20 m.
  const PLACES = [
    { name: "Miller Lite", kind: "stage", lat: 30.269023, lon: -97.769345 },
    { name: "T-Mobile", kind: "stage", lat: 30.267999, lon: -97.770249 },
    { name: "Tito's", kind: "stage", lat: 30.267783, lon: -97.765058 },
    { name: "American Express", kind: "stage", lat: 30.267233, lon: -97.763249 },
    { name: "BMI", kind: "stage", lat: 30.266759, lon: -97.769594 },
    { name: "Snapchat", kind: "stage", lat: 30.266732, lon: -97.766537 },
    { name: "Beatbox", kind: "stage", lat: 30.265401, lon: -97.768633 },
    { name: "Rock Island", kind: "area", lat: 30.268296, lon: -97.76906 },
    { name: "The Big Shade", kind: "area", lat: 30.267066, lon: -97.76862 },
    { name: "ACL Market", kind: "area", lat: 30.267479, lon: -97.766331 },
    { name: "Y'all Mart", kind: "area", lat: 30.267828, lon: -97.768567 },
    { name: "Cabanas", kind: "area", lat: 30.267529, lon: -97.764223 },
    { name: "Platinum Lounge", kind: "area", lat: 30.267606, lon: -97.763417 },
    { name: "Bungalows", kind: "area", lat: 30.267032, lon: -97.770094 },
    { name: "Lady Bird Entrance", kind: "gate", lat: 30.268861, lon: -97.770405 },
    { name: "Barton Springs West Entrance", kind: "gate", lat: 30.266429, lon: -97.769586 },
    { name: "Barton Springs East Entrance", kind: "gate", lat: 30.265407, lon: -97.765621 },
    { name: "VIP / Platinum Entrance", kind: "gate", lat: 30.26554, lon: -97.765277 },
  ];

  const M_PER_PX = 0.6;

  function toPixel(lat, lon) {
    return {
      x: ((lon - WEST) / (EAST - WEST)) * MAP_W,
      y: ((NORTH - lat) / (NORTH - SOUTH)) * MAP_H,
    };
  }

  for (const p of PLACES) Object.assign(p, toPixel(p.lat, p.lon));

  // Nearest named place to a map pixel; null when off the map or far from everything.
  function nearestPlace(x, y) {
    if (x < 0 || x > MAP_W || y < 0 || y > MAP_H) return null;
    let best = null;
    let bestD = Infinity;
    for (const p of PLACES) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bestD) { bestD = d; best = p; }
    }
    return bestD * M_PER_PX > 250 ? null : best;
  }

  return { MAP_W, MAP_H, M_PER_PX, PLACES, toPixel, nearestPlace };
});
