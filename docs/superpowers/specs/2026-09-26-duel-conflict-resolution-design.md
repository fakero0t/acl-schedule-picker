# Duel Conflict Resolution — Design

**Date:** 2026-09-26
**Status:** Approved design, pending spec review

## Purpose

After friends pick the ACL artists they want to see, many picks physically
conflict — you can't be at two stages at once when set times overlap. This
feature adds a **group decision phase**: once picking closes, the app presents
the time clashes one at a time as a quiz ("duels"), each showing the
overlapping shows and who voted for each, and asks every friend to choose where
the group should go. The tallied answers produce a shared **group plan**.

Success looks like: the host flips the app to duel mode, each returning friend
is met with a blocking modal that walks them through every clash, their partial
progress survives leaving and returning, and once they submit they never see it
again. A new group-plan view shows the winning show per clash.

## Scope decisions (from brainstorming)

- **Conflict source:** group-wide popular clashes. Everyone answers the same
  set of duels regardless of their own picks.
- **Duel shape:** N-way clash groups — one question per cluster of
  mutually-overlapping shows, pick one.
- **Outcome:** a new group-plan results view (does not alter `/results`).
- **Entry point:** an overlay modal shown on next app visit, not dismissable by
  clicking outside; resumable until submitted.
- **Progress storage:** server-side (SQLite), keyed by name, like picks.
- **Done semantics:** picking is **closed** (a phase flip) before duels begin,
  so the vote set — and therefore the clash set — is frozen. No dynamic-clash
  reconciliation is needed.
- **Close trigger:** manual admin action.

## Phases

A single app-wide phase stored in a new `meta` key/value table:

- `phase = "picking"` (default) — current behavior unchanged.
- `phase = "duel"` — picker is read-only (votes frozen); duel modal opens.

Flip mechanism: `POST /api/admin/phase { token, phase }`, guarded by an
`ADMIN_TOKEN` env var. A minimal `/admin` page provides a token input + two
buttons (Open picking / Close picking → duel). If `ADMIN_TOKEN` is unset
(local dev), a default token `dev` is accepted so the flow is testable locally.
The token is compared server-side only; never sent to non-admin clients.

## Clash detection — `data/clashes.js`

Pure module, no DB dependency. Signature:

```
computeClashes(artists, counts) -> [clash]
```

- `artists`: `schedule.ARTISTS` (each has `day`, `stage`, `name`, `timeLabel`,
  `rowStart`, `rowEnd`).
- `counts`: `id -> { total, ... }` from the results aggregation.

Algorithm, per day:
1. Keep only artists with `counts[id].total >= 1` (a clash needs real voters).
2. Two shows **overlap** iff same day and their `[rowStart, rowEnd)` intervals
   intersect (`a.rowStart < b.rowEnd && b.rowStart < a.rowEnd`).
3. Union-find over the overlap graph → connected components.
4. Every component with **≥2 shows** is one clash. Components of 1 are dropped.

Each clash:
```
{
  id,            // stable: `${day}:` + sorted member ids joined with "+"
  day,
  timeLabel,     // span from earliest start to latest end in the cluster
  options: [ { id, name, stage, timeLabel } ]   // sorted by rowStart then id
}
```

Clash `id` is deterministic and stable while votes are frozen. Clashes are
returned ordered by day (fri, sat, sun) then earliest `rowStart`.

**Known edge case (documented, accepted):** connected components can chain
(A–B overlap, B–C overlap, A–C do not), producing a cluster wider than any
single time instant. In practice ACL sets are 45–75 min and clusters stay
small; we accept chaining rather than compute maximal cliques. Noted here so a
future reader knows it was a deliberate simplification.

## Data model — `submissions` table

Two new columns, added via `ALTER TABLE` guarded for existing databases:

- `duel_answers TEXT NOT NULL DEFAULT '{}'` — JSON map `clashId -> choice`,
  where `choice` is a member artist id or the sentinel `"none"` (No preference).
- `duel_done INTEGER NOT NULL DEFAULT 0` — 0/1 completion flag.

`db.js` gains:
- Read of `duel_answers`/`duel_done` in `all()` and a `getByName(name)` helper.
- `saveDuelAnswer(name, clashId, choice)` — merge one answer into the map.
- `submitDuel(name)` — set `duel_done = 1`.
- `meta` helpers: `getPhase()` / `setPhase(phase)`.

The `meta` table:
```
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

Name matching stays case-insensitive and consistent with existing `/api/me`.

## Endpoints (`server.js`)

- `GET /api/phase` → `{ phase }`.
- `POST /api/admin/phase` `{ token, phase }` → validates token + phase value,
  sets it, returns `{ ok, phase }`. 403 on bad token, 400 on bad phase.
- `GET /api/duel?name=` → `{ phase, done, myAnswers, clashes }` where each clash
  option is enriched with `count` and `voters` (names) drawn from current picks.
  Returns `clashes: []` unless `phase === "duel"`.
- `POST /api/duel/answer` `{ name, clashId, choice }` → validates the clash id
  exists and `choice` is a member id or `"none"`; rejects if `phase !== "duel"`
  or the person has no submission; merges + saves. Idempotent.
- `POST /api/duel/submit` `{ name }` → sets `duel_done = 1`. Requires
  `phase === "duel"`.
- `GET /api/duel/results` → per clash: `{ clash, tally: {choice: count},
  chosenBy: {choice: [names]}, winner }`. `winner` is the choice with the most
  votes (`"none"` excluded from winning; ties → earliest `rowStart`).
- `GET /plan` → serves `public/plan.html`.

Existing `/api/submit` gains a guard: reject with 409 when
`phase !== "picking"` so votes can't change after close.

## UI

### Picker (`public/app.js`)
On `init()`, fetch `/api/phase`.
- `picking` → unchanged flow.
- `duel` → apply a read-only lock to the whole picker (reuse the existing
  `.locked` styling; hide Submit/Edit), and if the person has a name and a
  prior submission and `duel_done === 0`, open the duel modal.

### Duel modal (new, in `app.js` + markup in `index.html`, styles in `styles.css`)
- Overlay that is **not** outside-click dismissable (no backdrop click handler;
  no visible close button that abandons progress — leaving = navigate away or
  refresh, which is fine because answers are already saved server-side).
- One clash per screen: heading with the time span, the day, the N options as
  large tappable cards. Each card shows the show name, stage, its vote `count`,
  and the voter names. A final "No preference" option maps to `choice = "none"`.
- Footer: **Back** / **Next**, a progress indicator (e.g. `3 / 9`), and a
  **Submit** button enabled once every clash has an answer (including `none`).
- Selecting an option immediately `POST`s `/api/duel/answer` (partial save) and
  advances. Back re-renders a previous clash with its saved choice highlighted.
- Submit → `POST /api/duel/submit`, close the modal, toast, and offer a CTA to
  `/plan`. Modal never reappears (`duel_done` gate).
- Reuses existing tokens/typography; styled with the app's design system —
  no native dialogs/dropdowns.

### Group plan (`public/plan.html` + `public/plan.js`)
A dedicated view listing each clash as a card: the winning show highlighted,
the full vote split across options (including "No preference"), and who chose
what (reusing the results tooltip pattern or inline name lists). Polls
`/api/duel/results` like the results page polls its data. Reachable from a nav
link on the picker and results toolbars.

### Admin (`public/admin.html`)
Minimal: token input (stored in `localStorage` for convenience), current phase
display, and two buttons that call `POST /api/admin/phase`. Not linked from the
main UI; the host navigates to `/admin` directly.

## Component boundaries

- `data/clashes.js` — pure clash computation, unit-testable without a server.
- `db.js` — persistence for phase + duel answers; no HTTP concerns.
- `server.js` — HTTP wiring + validation + enrichment (joining clashes with
  live voter/count data).
- `public/app.js` — picker + duel modal client.
- `public/plan.js` — group-plan client.

## Testing (`test/api.test.js`, matching existing style)

1. **clash detection (unit):** given crafted `counts` over known
   overlapping/non-overlapping artist ids, assert cluster membership, the ≥2
   rule, and stable clash ids.
2. **phase flip:** default is `picking`; bad token → 403; valid flip → `duel`;
   `/api/submit` returns 409 once in duel phase.
3. **duel fetch:** in duel phase, `/api/duel` returns clashes enriched with
   counts + voters; empty in picking phase.
4. **partial save + resume:** answer a subset, re-fetch, assert `myAnswers`
   reflects saved choices and `done` is false.
5. **submit:** sets `done`; a subsequent fetch reports `done: true`.
6. **results tally:** multiple people's answers produce the expected winner and
   `chosenBy` lists; ties resolve to earliest start; `"none"` cannot win.

## Out of scope

- Automatic/deadline-based phase flips (manual only).
- Re-opening the duel for clashes that appear after submit (prevented by the
  frozen-vote phase model).
- Editing duel answers after submit.
- Changing the existing `/results` visualization.

## File touch list

- `db.js` — meta table, duel columns + helpers, migration.
- `data/clashes.js` — new pure module.
- `server.js` — new endpoints, submit guard, phase.
- `public/index.html` — duel modal markup, plan nav link.
- `public/app.js` — phase-aware init, duel modal logic.
- `public/results.html` — plan nav link.
- `public/plan.html`, `public/plan.js` — new group-plan view.
- `public/admin.html` — new admin control.
- `public/styles.css` — duel modal + plan card styles.
- `test/api.test.js` — new tests.
- `README.md` — document duel phase + admin flip.
