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

// [name, start, end|null, id?] — all times are PM. end null = single-time headliner.
// id defaults to day-stage-index; pass one to keep a moved set's original id.
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
  // Saturday re-transcribed from the updated day-of schedule. Sets that moved keep
  // their original id (4th element) so existing picks still point at them.
  sat: {
    tmobile: [["Balu Brigada", "3:05", "3:40", "sat-tmobile-1"], ["Suki Waterhouse", "4:25", "5:15", "sat-tmobile-2"], ["Bleachers", "6:15", "7:15", "sat-tmobile-3"], ["Lorde", "8:15", null, "sat-tmobile-4"]],
    millerlite: [["Temper City", "2:35", "3:05", "sat-millerlite-0"], ["Arcy Drive", "3:40", "4:25", "sat-millerlite-1"], ["Palace", "5:15", "6:15", "sat-beatbox-2"], ["Levity", "7:15", "8:15", "sat-millerlite-3"]],
    bmi: [["Emma Ogier", "2:35", "3:05", "sat-bmi-1"], ["Coleman Jennings", "3:40", "4:25", "sat-bmi-2"], ["Fai Laci", "5:15", "6:15", "sat-bmi-3"]],
    beatbox: [["Letrainiump", "2:25", "2:55", "sat-beatbox-4"], ["Cure for Paranoia", "3:25", "3:55", "sat-beatbox-0"], ["Night Tapes", "4:25", "5:05", "sat-tmobile-0"], ["Ryan Beatty", "5:50", "6:50", "sat-beatbox-1"], ["Snow Strippers", "7:35", "8:15", "sat-millerlite-2"]],
    titos: [["DJ Cassandra", "2:05", "2:45", "sat-titos-1"], ["Don West", "3:15", "4:00", "sat-titos-2"], ["Rodrigo y Gabriela", "4:30", "5:30", "sat-titos-3"], ["¥ØU$UK€ ¥UK1MAT$U", "6:30", "7:30", "sat-titos-4"], ["Silent Disco", "8:00", "10:00", "sat-titos-5"]],
    snapchat: [["Rochelle Jordan", "2:45", "3:15", "sat-snapchat-0"], ["Skye Newman", "3:55", "4:40", "sat-snapchat-1"], ["It's Murph", "5:30", "6:30", "sat-snapchat-2"], ["Lykke Li", "7:30", "8:30", "sat-snapchat-3"]],
    amex: [["Annie DiRusso", "2:15", "2:45", "sat-amex-0"], ["Finn Wolfhard", "3:15", "3:55", "sat-amex-1"], ["Young Miko", "4:40", "5:30", "sat-amex-2"], ["Lola Young", "6:30", "7:30", "sat-amex-3"], ["Rüfüs Du Sol", "8:30", null, "sat-amex-4"]],
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
      const [name, start, end, fixedId] = set;
      const startMin = minutesFromNoon(start);
      const endMin = end == null ? startMin + DEFAULT_SET_MIN : minutesFromNoon(end);
      const rowStart = Math.round((startMin - NOON) / SLOT_MIN) + 1;
      const rowEnd = Math.round((endMin - NOON) / SLOT_MIN) + 1;
      ARTISTS.push({
        id: fixedId || `${day.key}-${stage.key}-${idx}`,
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
if (VALID_IDS.size !== ARTISTS.length) throw new Error("schedule: duplicate artist ids");

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
