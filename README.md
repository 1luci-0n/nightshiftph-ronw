# NightShiftPH Planner

A guild ops tool for **Ragnarök: The New World** — built for Guild Leaders, Co-Leaders, and Admin Staff to manage member rosters and party lineups for Guild League and Polarity Zone without passing spreadsheets or screenshots back and forth.

## What's here (Phase 1)

Plain HTML, CSS, and vanilla JavaScript. No frameworks, no build step — just open the files in a browser.

- **`index.html`** — the full admin app (Inventory, Groups, Team Builder, Events, Admin).
- **`public.html`** — a read-only reference view members can check before assembly.
- **`styles.css`** — all styling and design tokens.
- **`app.js`** — all app logic and state.

### Features in this build
- **Member Inventory** — add members one at a time, or bulk-paste rows straight from a spreadsheet.
- **Groups** — cluster members who play together by schedule; Team Builder's Suggest feature prefers slotting from a party's existing group first.
- **Team Builder** — drag-and-drop members into Elite Team / Sub Team parties (8 parties each, 12 slots per party by default). A composition ring on every party card shows role coverage at a glance; a red ring segment means that role is under the minimum you've set.
- **Composition warnings** — a party missing a required role (e.g. no Healer) is flagged automatically. Admins can override with "Mark OK" if the comp is intentional (e.g. a farm party that doesn't need a healer).
- **Auto-fill suggestions** — click "Suggest" on an empty slot and it proposes the best available, unslotted member for the missing role — preferring the party's existing group, then sorted by gear rating.
- **Events & Participation** — log Guild League / Polarity Zone runs and track attendance per member over time.
- **Admin** — set guild name and the minimum role counts (Tank/Healer/DPS/Support) a party needs before it's flagged.

### Data storage right now
This build stores everything in the browser's `localStorage` — nothing leaves your device yet, and there's no live sync between different admins' browsers. That's intentional: this is the Phase 1 prototype for testing the workflow and UI. Use the **"Load sample roster"** button on the Admin tab to try it out immediately.

## Roadmap

- **Phase 2 — Firebase.** Swap the `STORE` object in `app.js` (currently backed by `localStorage`) for Firebase Firestore + Firebase Auth, loaded via CDN `<script>` tags (no npm install needed). This adds real accounts, roles, and live sync — so when a Co-Leader drags a member into a party, every other admin's screen updates in real time, and `public.html` reflects the latest saved state for regular members automatically.
- **Phase 3 — Auto-fill refinements & participation analytics.** Smarter suggestion ranking, contribution history views, per-member attendance trends.
- **v0.5 — Audit log.** A timestamped record of admin actions (verifications, edits, removals, claims) so Guild Leadership can cross-check what happened and when. This depends on Phase 2's real accounts/backend to be trustworthy across multiple admins.
- **Later — polish & amendments** as real guild usage surfaces edge cases.

## Running locally

No build step required. Because browsers restrict some features (like `fetch`) on `file://` URLs, it's best to serve the folder with a simple local server rather than double-clicking the HTML file:

```bash
# from inside this folder
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

Any static file server works — this is a static site.

## Notes for non-technical maintainers

- Everything about how a party is judged "ready" lives in **Admin → Composition rules**. If your guild's meta changes (e.g. you stop requiring a dedicated Support), just set that role's minimum to 0.
- Because of Ragnarök: The New World's Job Freedom system, a member's **Role tag** (Tank/Healer/DPS/Support) is set manually and separately from their class — re-check it after someone respecs, since gear rating alone won't tell you what they're playing right now.
- **"Reset all data"** on the Admin tab wipes everything stored in that browser. There's no undo — it's meant for clearing test/sample data before real use.
