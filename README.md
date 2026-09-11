# ACL Weekend 1 — Schedule Picker

A shareable web app that duplicates the **Austin City Limits 2026 Weekend One**
schedule (Fri/Sat/Sun) and lets you and your friends each tap the artists you
want to see, submit, and view a live group results board of who's seeing what.

- **`/`** — the picker. Day toggle (Fri/Sat/Sun), tap artist boxes (press-down
  feel + haptic on mobile), **Submit**, then **Edit** to change and resubmit.
- **`/results`** — live master view: each box shows a vote count, a highlighted
  border when picked, background color scaled by popularity (cream → orange →
  pink), and who voted on hover/tap. Auto-refreshes every 3s.

Everyone opens the same link and enters their name once (stored locally + with
their submission). One row per person in SQLite; resubmitting overwrites.

## Run locally

```
npm install
npm run dev
```

Open http://localhost:3000 (results at http://localhost:3000/results).

## Test

```
npm test
```

## Deploy to Render (TLDR)

1. Push this repo to GitHub (done).
2. Render dashboard → **New → Blueprint** → pick this repo → **Apply**
   (uses `render.yaml`: Starter instance + 1GB disk so votes persist).
3. Wait for the build, then share the `…onrender.com` URL with your friends.

**Free instead of paid:** in `render.yaml` remove the `disk:` block and set
`plan: free`. Deploys at $0, but the free filesystem is ephemeral — votes can
reset on redeploy/restart. Fine for a quick weekend, not for long-term storage.

## Stack

Node + Express, `better-sqlite3`, vanilla HTML/CSS/JS. Schedule data lives in
`data/schedule.js` (the single source of truth for the grid and valid pick ids).
