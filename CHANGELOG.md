# Changelog

All notable changes to NightShiftPH Planner, logged by date.

## 2026-08-19 — v0.4c (Suggest fix + confirmation safety net)

**Suggest — fixed to match the full original spec**
- Fixed: individual (ungrouped) members can now be Suggested too — previously Suggest refused entirely on any party with no group started, which was too strict.
- The corrected rule, with two closed pools that never mix: if a party already has a group started, Suggest only offers that group's remaining members. If a party has no group in it (empty, or only ungrouped individuals so far), Suggest only offers *other* ungrouped individuals. Either way, a real group is never split up, mixed with another group, or mixed with individuals automatically — only a deliberate manual drag does that.

**Confirmation safety net on every destructive action**
- Removing a party from a Roster team now always asks for confirmation, even when the party is empty (previously it silently deleted empty parties with no prompt).
- Removing a Staff assignment (Admin tab) now asks for confirmation before removing.
- **Deleting an Event** now opens a dedicated confirmation modal requiring you to type **DELETE** before the button unlocks — since this also wipes that event's attendance record permanently. All other Delete/Remove actions (members, groups, teams, queue entries) already had a standard confirm prompt — verified that's still the case.

**Roster**
- Clicking "+ New Elite Team" or "+ New Sub Team" now starts the team at **1/8 parties** instead of a full 8 — add more only as you need them. This also applies to the two teams that exist by default on a fresh install.

## 2026-08-19 — v0.4b (Roster & Events fixes)

**Suggest — now group-safe, as originally intended**
- Suggest now **only ever completes a group that's already started in this party**. If a party has 3 of a 5-member group placed (via individual drag or a partial group-drop), clicking Suggest on an empty slot will only offer that same group's remaining, available, unslotted members — nothing else.
- If a party has **no group started yet**, Suggest now refuses outright with a message pointing you to drag a group in or place someone manually — it will never introduce a brand-new group or an ungrouped individual on its own.
- If a party's group is fully placed or its remaining members are unavailable/already slotted, Suggest refuses rather than reaching for an outsider — so groups never get silently mixed. Filling a gap with a stand-in (e.g. covering for someone with an emergency) is now exclusively a manual, deliberate drag by an admin.

**Global one-team-only exclusivity (was previously per-team only)**
- Fixed a bug where the same group — or the same individual member — could be placed on more than one team at once (e.g. Elite Team 1 *and* Sub Team 1 *and* Sub Team 2 simultaneously). Slotting is now checked **across every team combined**, matching the real constraint that one character can only run one party at a time.
- The roster pool now dims a member or group chip as soon as they're placed on *any* team, not just the one you're currently viewing — so it's accurate no matter which team tab is active.
- Dragging a group onto a second team now correctly places 0 members (with an explanatory toast) once all its members are already slotted elsewhere, instead of silently duplicating them.

**Events — search bar for the auto-logged list too**
- The "Automatically logged from lineup" section in the Attendance modal now has its own search bar, so admins can quickly double-check that a specific auto-logged member is really in there — alongside the existing search for the manual "still needs checking" list.

## 2026-08-19 — v0.4 (Fixes & adjustments round 2)

**Roster (formerly "Team Builder")**
- Tab renamed to **Roster**.
- You can now **drag an entire group onto a party** in one motion — it fills the party's empty slots with that group's members in order. If the party doesn't have enough empty slots, or some group members are already slotted elsewhere in that team, you'll get a toast explaining exactly what happened and what didn't fit.
- Individual member dragging still works as before, for substitutions (e.g. swapping in a replacement when someone from a group is offline).
- The roster pool sidebar now shows two sections: **Groups** (drag onto a party) and **Members** (drag onto a slot).
- Suggest already prioritized groupmates of whoever's already in the party — left that logic in place, now with a clearer comment explaining why.

**Groups**
- Groups are now capped at **5 members** — matching a full party exactly, which is what makes the new whole-group drag work cleanly.
- A member already in another group is now disabled (greyed out) in the group edit checklist — they can't be double-assigned, since they can't be logged into two parties at once.
- Added a **search bar** inside the group edit modal to find members quickly.
- Removed the **Schedule Tag** field — groups now just have a name and members.
- The Members tab's own "Group" dropdown also now blocks assigning someone into an already-full group.

**Members (formerly "Inventory")**
- Tab renamed to **Members**.
- Class is now a proper dropdown grouped by base class, in this exact order: Swordsman (Knight, Crusader, Lord Knight, Paladin) → Mage (Wizard, High Wizard) → Archer (Hunter, Sniper) → Acolyte (Priest, High Priest, Monk, Champion) → Thief (Assassin, Assassin Cross) → Merchant (Blacksmith, Whitesmith) → Gunslinger (Rebel, Night Walker) → Druid (Karnos, Alitea). If an existing member has a class outside this list, it's preserved as a "(current)" option so nothing gets silently overwritten.
- Role **"Healer" renamed to "FS"** everywhere — role tags, composition rules, the ring indicator, filters.
- Availability simplified to just **Available / Unavailable** — "Unsure" removed. Existing "Unsure" members were migrated to "Available."

**Data migration**
- Opening the app after this update automatically converts old saved data: Healer → FS, Unsure → Available, old composition rules carried over under the new FS key. Nothing is lost.

**Noted for later**
- You asked about an **audit log** (timestamped record of admin actions — who verified what, when, edits made, etc.) for v0.5. Flagging that this is best built alongside Phase 2, since a trustworthy audit trail needs a real backend and accounts (Firebase) — a local-only, per-browser log can't reliably cross-verify what different admins did on their own devices. It's on the roadmap below.

## 2026-08-18 — v0.3 (Time Echoes Queue)

**New feature: Time Echoes Queue**
- Added a queue system for the weekly Time Echoes assist event, solving the guild-chat confusion around who's already receiving help.
- Public view now has a second page, **Time Echoes Queue**, where members search their own in-game name (matched against existing Inventory members — safe since RO names are unique), tick which of the 5 dungeons they need help with, and submit themselves to the queue.
- Dungeon picker uses icon buttons: 🦊 Moonlight Flower, 🦇 Dracula, 🎃 Jakk, 🫧 Bubble Dungeon, 👯 Twin Bosses.
- The public Queue Dashboard lists everyone waiting in first-come order, with a live status badge — "Waiting" or "Being helped by [name]" — so members can see at a glance who still needs a hand.
- **Admins** (index.html → Time Echoes Queue) can: **Claim** an entry (marks who's helping, shown publicly), **Edit** an entry's dungeons or member, **Mark helped** (removes it from the queue once cleared), or **Remove** an entry outright (e.g. duplicate/mistake). Admins can also register a member on someone else's behalf from this same screen.
- No cap on duplicate sign-ups, per your spec — the Claim status is what prevents double-coverage confusion, not a hard limit.

**Notes for this round**
- Dungeon names (Moonlight Flower, Dracula, Jakk, Bubble Dungeon, Twin Bosses) are placeholders based on your descriptions — easy to rename in `app.js` (the `DUNGEONS` constant near the top) if the game's official names differ.
- The "Claim" action currently uses a simple name prompt rather than a full login-linked identity, since real accounts arrive in Phase 2.

## 2026-08-18 — v0.2 (Amendments round 1)

**Team structure**
- Parties are now fixed at 5 slots each (was 12), matching actual RONW party size.
- Teams can now hold 1–8 parties (admin adjustable via "+ Add party" / remove per party), instead of always 8.
- You can now create up to **3 Elite Teams and 3 Sub Teams** each, not just one of each — for multi-team Guild League setups. New "+ New Elite Team" / "+ New Sub Team" buttons in Team Builder, with rename and delete per team.

**Roles**
- Removed the "Support" role. Only **Tank, Healer, DPS** remain. Composition rules, the ring indicator, and Suggest all updated to match.

**Inventory**
- "Class" is now a searchable dropdown (datalist) populated with real Ragnarök: The New World jobs (Swordsman, Mage, Archer, Acolyte, Thief, Merchant, Gunslinger, Druid, and their advanced branches) instead of free text.
- Added filter dropdowns for Role, Availability, and Group.
- Table headers are now clickable to sort ascending/descending by that column.

**Groups**
- Groups can now be **edited**, not just deleted — rename, change schedule tag, and reassign member membership from one place.

**Events & Attendance**
- Events can now be linked to one or more Team lineups.
- Log Attendance auto-marks anyone slotted into a linked team's parties as "participated" — admins only need to check off members who weren't part of the lineup.
- Added a search bar inside the Attendance modal.

**Public view**
- `public.html` now shows **only Team Builder** — Inventory, Groups, and Events are admin-only.

**Admin**
- Added a Staff & Permissions panel (placeholder ahead of real accounts in Phase 2): only the Guild Leader can assign Co-Leaders; Co-Leaders can assign Admin Staff but not other Co-Leaders.
- Composition rule inputs and "Reset all data" are now disabled for roles below Co-Leader.

## 2026-08-18 — v0.1 (Initial prototype)
- First working build: Member Inventory (add + bulk paste), Groups, Team Builder with drag-and-drop and composition warnings, Auto-fill Suggest, Events & Participation tracking, Admin composition rules, sample data loader.


**Team structure**
- Parties are now fixed at 5 slots each (was 12), matching actual RONW party size.
- Teams can now hold 1–8 parties (admin adjustable via "+ Add party" / remove per party), instead of always 8.
- You can now create up to **3 Elite Teams and 3 Sub Teams** each, not just one of each — for multi-team Guild League setups. New "+ New Elite Team" / "+ New Sub Team" buttons in Team Builder, with rename and delete per team.

**Roles**
- Removed the "Support" role. Only **Tank, Healer, DPS** remain. Composition rules, the ring indicator, and Suggest all updated to match.

**Inventory**
- "Class" is now a searchable dropdown (datalist) populated with real Ragnarök: The New World jobs (Swordsman, Mage, Archer, Acolyte, Thief, Merchant, Gunslinger, Druid, and their advanced branches) instead of free text.
- Added filter dropdowns for Role, Availability, and Group.
- Table headers are now clickable to sort ascending/descending by that column.

**Groups**
- Groups can now be **edited**, not just deleted — rename, change schedule tag, and reassign member membership from one place.

**Events & Attendance**
- Events can now be linked to one or more Team lineups.
- Log Attendance auto-marks anyone slotted into a linked team's parties as "participated" — admins only need to check off members who weren't part of the lineup.
- Added a search bar inside the Attendance modal.

**Public view**
- `public.html` now shows **only Team Builder** — Inventory, Groups, and Events are admin-only.

**Admin**
- Added a Staff & Permissions panel (placeholder ahead of real accounts in Phase 2): only the Guild Leader can assign Co-Leaders; Co-Leaders can assign Admin Staff but not other Co-Leaders.
- Composition rule inputs and "Reset all data" are now disabled for roles below Co-Leader.

## 2026-08-18 — v0.1 (Initial prototype)
- First working build: Member Inventory (add + bulk paste), Groups, Team Builder with drag-and-drop and composition warnings, Auto-fill Suggest, Events & Participation tracking, Admin composition rules, sample data loader.
