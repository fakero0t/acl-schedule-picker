// ACL Music Festival 2026 — Weekend One schedule (Oct 2–4).
// Source of truth for the grid layout AND the set of valid pick ids.
// Transcribed from the official schedule posters.

const SLOT_MIN = 15; // grid granularity
const NOON = 0; // minutes-from-noon baseline
const DAY_END_MIN = 600; // 10:00 PM => 40 slots of 15 min
const DEFAULT_SET_MIN = 75; // span for headliners listed with only a start time

const DAYS = [
  { key: "fri", label: "Friday", date: "October 02" },
  { key: "sat", label: "Saturday", date: "October 03" },
  { key: "sun", label: "Sunday", date: "October 04" },
];

const STAGES = [
  { key: "tmobile", label: "T-Mobile" },
  { key: "millerlite", label: "Miller Lite" },
  { key: "bmi", label: "BMI" },
  { key: "beatbox", label: "Beatbox" },
  { key: "titos", label: "Tito's Handmade Vodka" },
  { key: "snapchat", label: "Snapchat" },
  { key: "amex", label: "American Express" },
];

// [name, start, end|null] — all times are PM. end null = single-time headliner.
const RAW = {
  fri: {
    tmobile: [["Asleep at the Wheel", "1:00", "1:45"], ["New Constellations", "2:30", "3:15"], ["Jesse Welles", "4:15", "5:15"], ["Turnstile", "6:15", "7:15"], ["Skrillex", "8:15", null]],
    millerlite: [["Faouzia", "1:45", "2:30"], ["Paris Paloma", "3:15", "4:15"], ["Brandon Flowers", "5:15", "6:15"], ["Leon Thomas", "7:15", "8:15"]],
    bmi: [["Elle Coves", "1:45", "2:30"], ["Izzy Escobar", "3:30", "4:15"], ["Grocery Bag", "5:15", "6:15"]],
    beatbox: [["Night Traveler", "2:00", "2:45"], ["Marlon Funaki", "3:30", "4:30"], ["Rusowsky", "5:30", "6:30"], ["Molly Santana", "7:30", "8:30"]],
    titos: [["The 4411", "12:45", "1:30"], ["Solomon Hicks", "2:00", "2:45"], ["Bo Staloch", "3:15", "4:00"], ["Rebecca Black", "4:30", "5:30"], ["Steve Aoki", "6:30", "7:30"], ["Silent Disco", "8:00", "10:00"]],
    snapchat: [["Elijah Delgado", "2:00", "2:45"], ["LP", "3:30", "4:30"], ["Bunt.", "5:30", "6:30"], ["The Chainsmokers", "7:30", "8:30"]],
    amex: [["Hunx and His Punx", "1:15", "2:00"], ["CMAT", "2:45", "3:30"], ["Amyl and the Sniffers", "4:30", "5:30"], ["Labrinth", "6:30", "7:30"], ["Charli XCX", "8:40", null]],
  },
  sat: {
    tmobile: [["Night Tapes", "1:00", "1:45"], ["Balu Brigada", "2:30", "3:15"], ["Suki Waterhouse", "4:15", "5:15"], ["Bleachers", "6:15", "7:15"], ["Lorde", "8:15", null]],
    millerlite: [["Temper City", "1:45", "2:30"], ["Arcy Drive", "3:15", "4:15"], ["Snow Strippers", "5:15", "6:15"], ["Levity", "7:15", "8:15"]],
    bmi: [["Fightmaster", "12:45", "1:15"], ["Emma Ogier", "1:45", "2:30"], ["Coleman Jennings", "3:30", "4:15"], ["Fai Laci", "5:15", "6:15"]],
    beatbox: [["Cure for Paranoia", "2:00", "2:45"], ["Ryan Beatty", "3:30", "4:30"], ["Palace", "5:30", "6:30"], ["Fakemink", "7:30", "8:30"]],
    titos: [["Left Lucid", "12:45", "1:30"], ["DJ Cassandra", "2:00", "2:45"], ["Don West", "3:15", "4:00"], ["Rodrigo y Gabriela", "4:30", "5:30"], ["¥ØU$UK€ ¥UK1MAT$U", "6:30", "7:30"], ["Silent Disco", "8:00", "10:00"]],
    snapchat: [["Rochelle Jordan", "2:00", "2:45"], ["Skye Newman", "3:30", "4:30"], ["It's Murph", "5:30", "6:30"], ["Lykke Li", "7:30", "8:30"]],
    amex: [["Annie DiRusso", "1:15", "2:00"], ["Finn Wolfhard", "2:45", "3:30"], ["Young Miko", "4:30", "5:30"], ["Lola Young", "6:30", "7:30"], ["Rüfüs Du Sol", "8:30", null]],
  },
  sun: {
    tmobile: [["Solya", "1:15", "2:00"], ["Stella Lefty", "2:45", "3:30"], ["Audrey Hobert", "4:30", "5:30"], ["Geese", "6:30", "7:30"], ["The XX", "8:30", null]],
    millerlite: [["Jess Williamson", "2:00", "2:45"], ["Claire Rosinkranz", "3:30", "4:30"], ["Saint Motel", "5:30", "6:30"], ["Parcels", "7:30", "8:30"]],
    bmi: [["Rubio", "12:45", "1:15"], ["Aaron Rowe", "2:00", "2:45"], ["Fancy Hagood", "3:30", "4:15"], ["Lauren Sanderson", "5:30", "6:30"]],
    beatbox: [["Britton", "2:00", "2:45"], ["Underscores", "3:30", "4:30"], ["Noga Erez", "5:30", "6:30"], ["Blood Orange", "7:30", "8:30"]],
    titos: [["The Moriah Sisters", "12:45", "1:30"], ["Paloma Morphy", "2:00", "2:45"], ["Calder Allen", "3:15", "4:00"], ["Rio Kosta", "4:30", "5:30"], ["Fcukers", "6:30", "7:30"], ["Silent Disco", "8:00", "10:00"]],
    snapchat: [["Sunday (1994)", "2:00", "2:45"], ["Cannons", "5:30", "6:30"], ["The War on Drugs", "7:30", "8:30"]],
    amex: [["Villanelle", "1:15", "2:00"], ["Dexter and the Moonrocks", "2:45", "3:30"], ["Max McNown", "4:30", "5:30"], ["Sofi Tukker", "6:30", "7:30"], ["Twenty One Pilots", "8:30", null]],
  },
};

// Minutes from noon. All sets are PM; 12:xx stays in the noon hour.
function minutesFromNoon(t) {
  const [h, m] = t.split(":").map(Number);
  return (h === 12 ? 0 : h * 60) + m;
}

function formatTime(t) {
  return t; // already in H:MM display form
}

// Build the flat artist list with computed grid positions (1-indexed CSS rows).
const ARTISTS = [];
for (const day of DAYS) {
  for (const stage of STAGES) {
    const sets = RAW[day.key][stage.key] || [];
    sets.forEach((set, idx) => {
      const [name, start, end] = set;
      const startMin = minutesFromNoon(start);
      const endMin = end == null ? startMin + DEFAULT_SET_MIN : minutesFromNoon(end);
      const rowStart = Math.round((startMin - NOON) / SLOT_MIN) + 1;
      const rowEnd = Math.round((endMin - NOON) / SLOT_MIN) + 1;
      ARTISTS.push({
        id: `${day.key}-${stage.key}-${idx}`,
        day: day.key,
        stage: stage.key,
        name,
        start: formatTime(start),
        end: end,
        timeLabel: end ? `${start} – ${end}` : start,
        rowStart,
        rowEnd,
      });
    });
  }
}

const VALID_IDS = new Set(ARTISTS.map((a) => a.id));

// Total number of 15-min rows on the grid (12:00 PM -> 10:00 PM).
const TOTAL_ROWS = DAY_END_MIN / SLOT_MIN;

// Hour labels down the left axis (12 PM .. 10 PM).
const HOUR_LABELS = [];
for (let mm = 0; mm <= DAY_END_MIN; mm += 60) {
  const hr = mm === 0 ? 12 : mm / 60;
  HOUR_LABELS.push({ row: Math.round(mm / SLOT_MIN) + 1, label: `${hr} PM` });
}

module.exports = {
  DAYS,
  STAGES,
  ARTISTS,
  VALID_IDS,
  TOTAL_ROWS,
  HOUR_LABELS,
  SLOT_MIN,
};
