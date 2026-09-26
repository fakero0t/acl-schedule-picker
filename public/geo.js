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

  // Stages, areas and gates. Positions are estimated from the official ACL 2026
  // map (not surveyed on-site), so treat them as roughly ±30 m.
  const PLACES = [
    { name: "Miller Lite", kind: "stage", lat: 30.268958, lon: -97.768774 },
    { name: "T-Mobile", kind: "stage", lat: 30.267999, lon: -97.770249 }, // west stage, per aerial photo
    { name: "Tito's", kind: "stage", lat: 30.268504, lon: -97.765208 },
    { name: "American Express", kind: "stage", lat: 30.26721, lon: -97.763066 },
    { name: "BMI", kind: "stage", lat: 30.26661, lon: -97.769184 },
    { name: "Snapchat", kind: "stage", lat: 30.266657, lon: -97.767084 },
    { name: "Beatbox", kind: "stage", lat: 30.264963, lon: -97.76934 },
    { name: "Austin Kiddie Limits", kind: "stage", lat: 30.265844, lon: -97.765757 },
    { name: "Bonus Tracks", kind: "area", lat: 30.265768, lon: -97.766989 },
    { name: "The Big Tent", kind: "area", lat: 30.268819, lon: -97.767938 },
    { name: "Rock Island", kind: "area", lat: 30.268295, lon: -97.768565 },
    { name: "The Big Shade", kind: "area", lat: 30.267007, lon: -97.768354 },
    { name: "ACL Market", kind: "area", lat: 30.268096, lon: -97.766917 },
    { name: "Y'all Mart", kind: "area", lat: 30.267711, lon: -97.768156 },
    { name: "Merch Palace", kind: "area", lat: 30.265252, lon: -97.767167 },
    { name: "Cabanas", kind: "area", lat: 30.267889, lon: -97.764591 },
    { name: "Platinum Lounge", kind: "area", lat: 30.267905, lon: -97.763046 },
    { name: "Bungalows", kind: "area", lat: 30.26702, lon: -97.769573 },
    { name: "Lady Bird Entrance", kind: "gate", lat: 30.268722, lon: -97.77031 },
    { name: "Barton Springs West Entrance", kind: "gate", lat: 30.266367, lon: -97.770098 },
    { name: "Barton Springs East Entrance", kind: "gate", lat: 30.264752, lon: -97.76569 },
    { name: "VIP / Platinum Entrance", kind: "gate", lat: 30.265273, lon: -97.765083 },
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
